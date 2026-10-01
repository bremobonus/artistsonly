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
