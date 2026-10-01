import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  appendPersonNote,
  identity,
  journal,
  newId,
  nowIso,
  rememberLongTerm,
  saveDraft,
  setDraftStatus,
  state,
} from "./lib/brain.js";
import { emailConfigured, sendMail } from "./integrations/notify.js";
import { calendarInsert, googleConfigured } from "./integrations/google.js";
import { push } from "./integrations/notify.js";
import { firstName, loadTuro, markAction, queueAction, saveTuro, tripLink, vehicleName } from "./lib/turo.js";

/** Tools Akira can call while reasoning. Every write goes through the journal. */
export function akiraTools(cycle: string) {
  const remember = betaZodTool({
    name: "remember",
    description:
      "Write a durable fact to long-term memory (MEMORY.md) under a section, and journal it with its source. Use for facts that will matter later: dates, promises, preferences, people, money, decisions.",
    inputSchema: z.object({
      section: z.string().describe("MEMORY.md section, e.g. 'Amos', 'People', 'Projects', 'Open loops', 'Money', 'Legal'"),
      fact: z.string().describe("One clear sentence. Include the date it was learned if relevant."),
      source: z.string().describe("Where this came from: event id, URL, device, or journal id."),
      kind: z.enum(["fact", "commitment", "decision"]).default("fact"),
    }),
    run: async (i) => {
      const line = `${i.fact} _(src: ${i.source})_`;
      rememberLongTerm(i.section, line);
      const j = journal({ kind: i.kind, source: i.source, summary: i.fact, tags: [cycle, i.section.toLowerCase()] });
      return `remembered ${j.id}`;
    },
  });

  const notePerson = betaZodTool({
    name: "note_person",
    description: "Append a dated note about a person to their file in memory/people/<slug>.md.",
    inputSchema: z.object({
      slug: z.string().describe("lowercase-hyphen slug, e.g. 'jane-doe'"),
      note: z.string(),
      source: z.string(),
    }),
    run: async (i) => {
      appendPersonNote(i.slug, `${nowIso()} — ${i.note} _(src: ${i.source})_`);
      journal({ kind: "fact", source: i.source, summary: `[${i.slug}] ${i.note}`, tags: [cycle, "person"] });
      return "noted";
    },
  });

  const setReminder = betaZodTool({
    name: "set_reminder",
    description: "Create a reminder for Amos at a specific time (ISO-8601 with timezone).",
    inputSchema: z.object({
      text: z.string(),
      due: z.string().describe("ISO-8601 with offset, e.g. 2026-10-01T09:00:00-04:00"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      source: z.string(),
    }),
    run: async (i) => {
      const r = state.reminders();
      const dup = r.items.find((x) => !x.done && x.text === i.text && x.due === i.due);
      if (dup) return `already exists ${dup.id}`;
      const id = newId("rem");
      r.items.push({ id, text: i.text, due: i.due, priority: i.priority, done: false, source: i.source, createdAt: nowIso() });
      r.updatedAt = nowIso();
      state.saveReminders(r);
      journal({ kind: "event", source: i.source, summary: `Reminder set: ${i.text} at ${i.due}`, tags: [cycle, "reminder"], refs: [id] });
      return `reminder ${id}`;
    },
  });

  const addCalendarEvent = betaZodTool({
    name: "add_calendar_event",
    description: "Put an event on Amos's calendar. It appears in the Akira ICS feed he subscribes to.",
    inputSchema: z.object({
      title: z.string(),
      start: z.string().describe("ISO-8601 with offset"),
      end: z.string().optional(),
      allDay: z.boolean().default(false),
      location: z.string().optional(),
      notes: z.string().optional(),
      source: z.string(),
    }),
    run: async (i) => {
      const c = state.calendar();
      const dup = c.events.find((e) => e.title === i.title && e.start === i.start);
      if (dup) return `already exists ${dup.id}`;
      const id = newId("cal");
      let googleId: string | undefined;
      if (googleConfigured()) {
        try {
          googleId = await calendarInsert({ ...i, timezone: identity().owner.timezone });
        } catch (e) {
          journal({ kind: "system", source: i.source, summary: `Google Calendar insert failed for "${i.title}": ${(e as Error).message.slice(0, 200)}`, tags: [cycle, "calendar", "error"] });
        }
      }
      c.events.push({ id, title: i.title, start: i.start, end: i.end, allDay: i.allDay, location: i.location, notes: i.notes, source: i.source, createdAt: nowIso(), googleId });
      c.events.sort((a, b) => a.start.localeCompare(b.start));
      c.updatedAt = nowIso();
      state.saveCalendar(c);
      journal({ kind: "event", source: i.source, summary: `Calendar: ${i.title} at ${i.start}${googleId ? " (also on Google Calendar)" : ""}`, tags: [cycle, "calendar"], refs: [id] });
      return `event ${id}${googleId ? " + google " + googleId : ""}`;
    },
  });

  const draftEmail = betaZodTool({
    name: "draft_email",
    description: "Save an email draft for Amos to review. Never sends. Write in Amos's voice.",
    inputSchema: z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      why: z.string().describe("One line: why this draft exists."),
      source: z.string(),
    }),
    run: async (i) => {
      const d = saveDraft({ ...i });
      journal({ kind: "draft", source: i.source, summary: `Draft to ${i.to}: ${i.subject}`, tags: [cycle, "draft"], refs: [d.id] });
      return `draft ${d.id}`;
    },
  });

  const sendEmail = betaZodTool({
    name: "send_email",
    description:
      "Send an email now from akira@artistsonly.io on Amos's behalf. Use when a reply or outreach is clearly needed and you have the facts. Write in Amos's voice unless writing as Akira makes more sense (say so). The full text is journaled. If sending is not configured, it is saved as a draft instead.",
    inputSchema: z.object({
      to: z.array(z.string()).min(1),
      subject: z.string(),
      body: z.string(),
      why: z.string().describe("One line: why this email is being sent."),
      source: z.string(),
    }),
    run: async (i) => {
      const to = i.to.join(", ");
      const draft = saveDraft({ to, subject: i.subject, body: i.body, why: i.why, source: i.source });
      if (!emailConfigured()) {
        journal({ kind: "draft", source: i.source, summary: `Email NOT sent (sending not configured), saved as draft to ${to}: ${i.subject}`, tags: [cycle, "email"], refs: [draft.id] });
        return `sending not configured; saved draft ${draft.id}`;
      }
      const id = await sendMail({ to: i.to, subject: i.subject, text: i.body, replyTo: identity().owner.emails?.[0] });
      if (!id) {
        journal({ kind: "draft", source: i.source, summary: `Email send FAILED, kept as draft to ${to}: ${i.subject}`, tags: [cycle, "email", "error"], refs: [draft.id] });
        return `send failed; draft ${draft.id} kept`;
      }
      setDraftStatus(draft.id, "sent");
      journal({ kind: "event", source: i.source, summary: `Email sent to ${to}: ${i.subject} — ${i.why}`, tags: [cycle, "email", "sent"], refs: [draft.id], data: { to: i.to, subject: i.subject, body: i.body, providerId: id } });
      return `sent ${id}`;
    },
  });

  const setPriorities = betaZodTool({
    name: "set_priorities",
    description: "Replace today's prioritised list. Keep it to 3-7 items. Explain why each matters.",
    inputSchema: z.object({
      date: z.string().describe("YYYY-MM-DD in Amos's timezone"),
      items: z.array(z.object({ rank: z.number().int(), text: z.string(), why: z.string(), status: z.enum(["todo", "doing", "done", "dropped"]).default("todo") })),
      notes: z.string().default(""),
    }),
    run: async (i) => {
      state.savePriorities({ ...i, updatedAt: nowIso() });
      journal({ kind: "decision", source: cycle, summary: `Priorities for ${i.date}: ${i.items.map((x) => x.text).join("; ")}`, tags: [cycle, "priorities"] });
      return "priorities saved";
    },
  });

  const logDecision = betaZodTool({
    name: "log_decision",
    description: "Record a decision you made on Amos's behalf and why. Amos does not want to be asked; decide, act, and log it here so he can see it on the dashboard.",
    inputSchema: z.object({ text: z.string().describe("What you decided / did"), context: z.string().describe("Why, and what it was based on") }),
    run: async (i) => {
      const q = state.questions();
      const id = newId("q");
      q.items.unshift({ id, text: i.text, context: i.context, askedAt: nowIso() });
      q.updatedAt = nowIso();
      state.saveQuestions(q);
      journal({ kind: "decision", source: cycle, summary: `${i.text} — ${i.context}`, tags: [cycle, "decision"], refs: [id] });
      return `decision ${id}`;
    },
  });

  const healthFlag = betaZodTool({
    name: "health_flag",
    description: "Record a health observation for Amos. level: info (fyi), watch (trend to monitor), concern (suggest action / doctor).",
    inputSchema: z.object({ level: z.enum(["info", "watch", "concern"]), text: z.string() }),
    run: async (i) => {
      const h = state.health();
      h.flags.unshift({ ts: nowIso(), level: i.level, text: i.text });
      h.flags = h.flags.slice(0, 100);
      h.updatedAt = nowIso();
      state.saveHealth(h);
      journal({ kind: "health", source: cycle, summary: `[${i.level}] ${i.text}`, tags: [cycle, "health"] });
      return "flagged";
    },
  });

  const recordMention = betaZodTool({
    name: "record_mention",
    description: "Log a public web mention of Amos or artistsonly.io. Always include the exact URL.",
    inputSchema: z.object({
      url: z.string(),
      title: z.string(),
      site: z.string(),
      publishedAt: z.string().optional(),
      summary: z.string().describe("Neutral, factual, 1-3 sentences."),
      sentiment: z.enum(["positive", "neutral", "negative", "unknown"]),
      severity: z.enum(["info", "watch", "act"]),
    }),
    run: async (i) => {
      const m = state.mentions();
      if (m.items.some((x) => x.url === i.url)) return "already logged";
      const id = newId("men");
      m.items.unshift({ id, ...i, foundAt: nowIso() });
      m.updatedAt = nowIso();
      state.saveMentions(m);
      journal({ kind: "mention", source: i.url, summary: `${i.site}: ${i.title} — ${i.summary}`, tags: [cycle, "mention", i.severity], refs: [id] });
      return `mention ${id}`;
    },
  });

  return { remember, notePerson, setReminder, addCalendarEvent, draftEmail, sendEmail, setPriorities, logDecision, healthFlag, recordMention };
}

/** Turok's tools: Amos's Turo fleet, trips, guest messages and the Turo outbox. Every write is journaled. */
export function turokTools(cycle: string) {
  const upsertVehicle = betaZodTool({
    name: "turo_upsert_vehicle",
    description: "Add or update a car in Amos's Turo fleet. Use a stable id slug like 'tesla-model-3-white'. Only set fields you actually observed.",
    inputSchema: z.object({
      id: z.string(),
      name: z.string().describe("e.g. '2022 Tesla Model 3'"),
      plate: z.string().optional(),
      listingUrl: z.string().optional(),
      pickup: z.string().optional(),
      checkin: z.string().optional(),
      basePrice: z.number().optional(),
      minPrice: z.number().optional(),
      maxPrice: z.number().optional(),
      active: z.boolean().optional(),
      notes: z.string().optional(),
      source: z.string(),
    }),
    run: async (i) => {
      const s = loadTuro();
      const prev = s.vehicles.find((v) => v.id === i.id);
      const defined = Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined));
      const v = { active: true, ...prev, ...defined, updatedAt: nowIso() } as (typeof s.vehicles)[number];
      s.vehicles = [...s.vehicles.filter((x) => x.id !== i.id), v];
      saveTuro(s);
      journal({ kind: "fact", source: i.source, summary: `Turo vehicle ${prev ? "updated" : "added"}: ${i.name} (${i.id})`, tags: [cycle, "turok", "turo", "vehicle"], data: defined });
      return `vehicle ${i.id} ${prev ? "updated" : "added"}`;
    },
  });

  const upsertTrip = betaZodTool({
    name: "turo_upsert_trip",
    description: "Record or update a Turo trip (request, booking, change, cancellation). Use Turo's reservation number as id when present. Times ISO-8601 with offset.",
    inputSchema: z.object({
      id: z.string().describe("Turo reservation id, or a stable slug if none"),
      vehicleId: z.string().optional(),
      guest: z.string(),
      start: z.string(),
      end: z.string(),
      status: z.enum(["requested", "booked", "in_progress", "completed", "cancelled", "declined"]),
      total: z.number().optional().describe("Host earnings or trip total as stated in the email"),
      pickup: z.string().optional(),
      reservationUrl: z.string().optional(),
      notes: z.string().optional(),
      source: z.string(),
    }),
    run: async (i) => {
      const s = loadTuro();
      const prev = s.trips.find((t) => t.id === i.id);
      const defined = Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined));
      const t = { createdAt: nowIso(), lifecycle: {}, ...prev, ...defined, updatedAt: nowIso() } as (typeof s.trips)[number];
      // A changed time re-arms the time-based steps so the guest gets correct details.
      if (prev && (prev.start !== i.start || prev.end !== i.end)) t.lifecycle = { booked: prev.lifecycle.booked ?? nowIso() };
      s.trips = [...s.trips.filter((x) => x.id !== i.id), t].sort((a, b) => a.start.localeCompare(b.start));
      saveTuro(s);
      journal({ kind: "event", source: i.source, summary: `Turo trip ${i.id} ${prev ? `${prev.status} -> ${i.status}` : i.status}: ${i.guest}, ${vehicleName(s, i.vehicleId)}, ${i.start} to ${i.end}${i.total ? `, $${i.total}` : ""}`, tags: [cycle, "turok", "turo", "trip", i.status], refs: [i.id], data: defined });
      return `trip ${i.id} saved (${i.status})`;
    },
  });

  const logGuestMessage = betaZodTool({
    name: "turo_log_message",
    description: "Record a message a guest sent on Turo (from a Turo notification email), verbatim.",
    inputSchema: z.object({ guest: z.string(), text: z.string(), ts: z.string(), tripId: z.string().optional(), source: z.string() }),
    run: async (i) => {
      const s = loadTuro();
      if (s.messages.some((m) => m.source === i.source && m.text === i.text)) return "already logged";
      const id = newId("tmsg");
      s.messages.push({ id, ts: i.ts, tripId: i.tripId, guest: i.guest, direction: "in", text: i.text, source: i.source });
      s.messages = s.messages.slice(-2000);
      saveTuro(s);
      journal({ kind: "event", source: i.source, summary: `Turo message from ${i.guest}${i.tripId ? ` (trip ${i.tripId})` : ""}: ${i.text}`, tags: [cycle, "turok", "turo", "guest-message"], refs: [id], ts: i.ts });
      return `logged ${id}`;
    },
  });

  const reply = betaZodTool({
    name: "turo_reply",
    description:
      "Reply to a guest on Turo in Amos's voice. Queues the exact text in the Turo outbox and pushes it to Amos to paste. If a needed fact is missing, send a short holding reply and put what is missing in `needs`.",
    inputSchema: z.object({
      guest: z.string(),
      text: z.string(),
      why: z.string(),
      tripId: z.string().optional(),
      needs: z.string().optional(),
      urgent: z.boolean().default(false).describe("Safety, accident, lockout, guest waiting at the car"),
      source: z.string(),
    }),
    run: async (i) => {
      const s = loadTuro();
      const trip = s.trips.find((t) => t.id === i.tripId);
      const a = queueAction(s, { kind: "message", title: `Reply to ${firstName(i.guest)}`, body: i.text, why: i.why, tripId: i.tripId, vehicleId: trip?.vehicleId, guest: i.guest, link: tripLink(s, trip), needs: i.needs, source: i.source });
      saveTuro(s);
      await push(`Turok → ${firstName(i.guest)}${i.needs ? " (needs info)" : ""}`, `${i.text}\n\n${i.needs ? `Missing: ${i.needs}\n` : ""}${a.link}`, i.urgent ? 5 : 4);
      return `queued ${a.id}`;
    },
  });

  const queue = betaZodTool({
    name: "turo_queue_action",
    description: "Queue any other Turo action for Amos to apply: accept or decline a request, file a damage/toll/fuel claim, leave a guest review, change a listing.",
    inputSchema: z.object({
      kind: z.enum(["accept", "decline", "claim", "review", "listing", "other"]),
      title: z.string(),
      body: z.string().describe("Exact text / steps, ready to paste"),
      why: z.string(),
      tripId: z.string().optional(),
      vehicleId: z.string().optional(),
      guest: z.string().optional(),
      priority: z.enum(["normal", "high", "urgent"]).default("normal"),
      source: z.string(),
    }),
    run: async (i) => {
      const s = loadTuro();
      const trip = s.trips.find((t) => t.id === i.tripId);
      const { priority, ...rest } = i;
      const a = queueAction(s, { ...rest, link: tripLink(s, trip) });
      saveTuro(s);
      await push(`Turok: ${i.title}`, `${i.body}\n\nWhy: ${i.why}\n${a.link}`, priority === "urgent" ? 5 : priority === "high" ? 4 : 3);
      return `queued ${a.id}`;
    },
  });

  const mark = betaZodTool({
    name: "turo_mark_action",
    description: "Mark a Turo outbox action done or skipped when Amos says he applied (or rejected) it.",
    inputSchema: z.object({ id: z.string(), status: z.enum(["done", "skipped"]), source: z.string() }),
    run: async (i) => {
      const s = loadTuro();
      const a = markAction(s, i.id, i.status, i.source);
      if (!a) return `no action ${i.id}`;
      saveTuro(s);
      return `${i.id} ${i.status}`;
    },
  });

  const demand = betaZodTool({
    name: "turo_add_demand_event",
    description: "Record a local event or holiday that moves rental demand (concert, festival, sports final, long weekend). Prices on those dates are multiplied.",
    inputSchema: z.object({
      name: z.string(),
      start: z.string().describe("YYYY-MM-DD"),
      end: z.string().describe("YYYY-MM-DD, inclusive"),
      multiplier: z.number().min(0.5).max(2),
      area: z.string().optional(),
      source: z.string().describe("URL or where this came from"),
    }),
    run: async (i) => {
      const s = loadTuro();
      if (s.demandEvents.some((e) => e.name === i.name && e.start === i.start)) return "already known";
      const id = newId("tdem");
      s.demandEvents.push({ id, ...i });
      s.demandEvents = s.demandEvents.filter((e) => e.end >= new Date(Date.now() - 86400_000).toISOString().slice(0, 10));
      saveTuro(s);
      journal({ kind: "fact", source: i.source, summary: `Turo demand: ${i.name} ${i.start}..${i.end} ×${i.multiplier}${i.area ? ` (${i.area})` : ""}`, tags: [cycle, "turok", "turo", "pricing"], refs: [id] });
      return `demand ${id}`;
    },
  });

  return { upsertVehicle, upsertTrip, logGuestMessage, reply, queue, mark, demand };
}
