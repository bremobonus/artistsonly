import { activity, journal, newId, nowIso, state } from "../lib/brain.js";
import { runAgent } from "../lib/claude.js";
import { akiraTools, turokTools } from "../tools.js";
import { push } from "../integrations/notify.js";
import { calendarInsert, googleConfigured } from "../integrations/google.js";
import {
  bookedDates,
  dueSteps,
  firstName,
  fmtWhen,
  loadTuro,
  localDate,
  markAction,
  ownerTz,
  priceCalendar,
  priceChanges,
  priceLines,
  queueAction,
  renderTemplate,
  saveTuro,
  tripLink,
  turoConfig,
  turokSoul,
  vehicleName,
  type LifecycleStep,
} from "../lib/turo.js";
import type { IngestEvent, TuroState, TuroTrip } from "../lib/types.js";

const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

function snapshot(s: TuroState) {
  const tz = ownerTz();
  const today = localDate(Date.now(), tz);
  return {
    config: turoConfig(),
    vehicles: s.vehicles,
    trips: s.trips.filter((t) => t.end.slice(0, 10) >= today || t.status === "requested").slice(0, 60),
    recentMessages: s.messages.slice(-40),
    openActions: s.outbox.filter((a) => a.status === "queued").slice(0, 40),
  };
}

/** Deterministic outbox results posted to /api/akira/ingest?source=turo&type=action-result. */
export function applyTuroResults(events: IngestEvent[]): IngestEvent[] {
  const rest: IngestEvent[] = [];
  const s = loadTuro();
  let changed = false;
  for (const ev of events) {
    const p = (ev.payload ?? {}) as { actionId?: string; status?: string };
    if (ev.type === "action-result" && p.actionId && (p.status === "done" || p.status === "skipped")) {
      changed = !!markAction(s, p.actionId, p.status, `turo:${ev.device ?? "-"}:${ev.id}`) || changed;
    } else rest.push(ev);
  }
  if (changed) saveTuro(s);
  return rest;
}

/** Turok reads Turo emails and Turo events: trips, guest messages, payouts, claims. Replies to guests. */
export async function turokDigest(events: IngestEvent[]): Promise<void> {
  if (!events.length) return;
  if (!hasKey()) {
    activity("turok", "skipped", `${events.length} Turo event(s) archived but not read: ANTHROPIC_API_KEY is not set`);
    return;
  }
  const t = turokTools("turok");
  const a = akiraTools("turok");
  const { text } = await runAgent({
    cycle: "turok",
    instructions: [
      turokSoul(),
      "",
      "## This turn",
      "Below are new emails from Turo and other Turo events, with Turok's current fleet, trips and open outbox.",
      "For each one:",
      "- New car mentioned -> turo_upsert_vehicle. Trip request/booking/change/cancellation/extension -> turo_upsert_trip with exact times (Amos's timezone if the email omits one).",
      "- Trip request -> decide accept or decline per config.booking (conflicts with booked trips of the same car, buffer hours, min trip days) and turo_queue_action; log_decision with the reason.",
      "- Guest message -> turo_log_message verbatim, then turo_reply with the answer (use vehicle pickup/checkin/notes and config.houseRules; never invent).",
      "- Payout / earnings -> remember under 'Money' with amount, trip and date. Damage, tolls, tickets, fuel, late return -> turo_queue_action kind 'claim' and set_reminder before the claim window closes.",
      "- Reviews, policy notices, account warnings -> remember under 'Turo'; anything legal or account-threatening -> log_decision and queue an action.",
      "Do not queue welcome / pre-trip / checkout / thank-you messages: the lifecycle tick sends those from templates.",
      "Finish with 2-5 plain lines of what happened.",
    ].join("\n"),
    userContent: "## Turok state\n```json\n" + JSON.stringify(snapshot(loadTuro()), null, 1) + "\n```\n\n## New Turo events\n```json\n" + JSON.stringify(events, null, 1).slice(0, 200_000) + "\n```",
    tools: [t.upsertVehicle, t.upsertTrip, t.logGuestMessage, t.reply, t.queue, t.mark, t.demand, a.remember, a.notePerson, a.setReminder, a.logDecision],
    maxIterations: 40,
  });
  journal({ kind: "system", source: "turok", summary: `Turok read ${events.length} Turo event(s): ${text.slice(0, 800)}`, refs: events.map((e) => e.id), tags: ["turok", "turo", "digest"] });
  activity("turok", "digested", `${events.length} Turo event(s)`);
}

async function lifecycleStep(s: TuroState, trip: TuroTrip, step: LifecycleStep, tz: string): Promise<void> {
  const c = turoConfig();
  const v = s.vehicles.find((x) => x.id === trip.vehicleId);
  const vehicle = vehicleName(s, trip.vehicleId);
  const src = `turok:lifecycle:${trip.id}`;
  const H = 3600_000;
  const reminder = (text: string, dueMs: number, priority: "normal" | "high") => {
    const r = state.reminders();
    const id = newId("rem");
    r.items.push({ id, text, due: new Date(dueMs).toISOString(), priority, done: false, source: src, createdAt: nowIso() });
    r.updatedAt = nowIso();
    state.saveReminders(r);
    journal({ kind: "event", source: src, summary: `Reminder set: ${text}`, tags: ["turok", "turo", "reminder"], refs: [id] });
  };
  switch (step) {
    case "booked":
    case "preTrip":
    case "checkoutReminder":
    case "thankYou": {
      const { text, missing } = renderTemplate(c.templates[step], {
        guest: firstName(trip.guest),
        vehicle,
        host: c.hostName,
        start: fmtWhen(trip.start, tz),
        end: fmtWhen(trip.end, tz),
        pickup: trip.pickup ?? v?.pickup,
        checkin: v?.checkin,
      });
      const titles = { booked: "Welcome", preTrip: "Pre-trip details", checkoutReminder: "Checkout reminder", thankYou: "Thank-you" };
      const a = queueAction(s, { kind: "message", title: `${titles[step]} → ${firstName(trip.guest)}`, body: text, why: `Trip ${trip.id} lifecycle: ${step}`, tripId: trip.id, vehicleId: trip.vehicleId, guest: trip.guest, link: tripLink(s, trip), needs: missing.length ? `fleet record has no ${missing.join(", ")} for ${vehicle}` : undefined, source: src });
      await push(`Turok → ${firstName(trip.guest)}: ${titles[step]}`, `${text}\n\n${a.needs ? `Missing: ${a.needs}\n` : ""}${a.link}`, 4);
      break;
    }
    case "start":
      trip.status = "in_progress";
      journal({ kind: "event", source: src, summary: `Turo trip ${trip.id} started: ${trip.guest} in ${vehicle}`, tags: ["turok", "turo", "trip"], refs: [trip.id] });
      break;
    case "end":
      trip.status = "completed";
      journal({ kind: "event", source: src, summary: `Turo trip ${trip.id} ended: ${trip.guest}, ${vehicle}`, tags: ["turok", "turo", "trip"], refs: [trip.id] });
      break;
    case "prepReminder":
      reminder(`Clean, charge/fuel and photograph the ${vehicle} for ${trip.guest}'s trip (${fmtWhen(trip.start, tz)})`, Date.parse(trip.start) - c.lifecycle.prepReminderHoursBefore * H, "normal");
      break;
    case "claimReminder":
      reminder(`Inspect the ${vehicle} after ${trip.guest}'s trip: photos, fuel, mileage, damage, smoking. Damage claim window closes ${fmtWhen(new Date(Date.parse(trip.end) + c.lifecycle.damageClaimWindowHours * H).toISOString(), tz)}`, Date.parse(trip.end) + H, "high");
      break;
    case "reimburseReminder":
      reminder(`Submit tolls / tickets / fuel / mileage reimbursements for Turo trip ${trip.id} (${trip.guest}) if any`, Date.parse(trip.end) + 7 * 86400_000, "normal");
      break;
    case "calendar": {
      const title = `Turo: ${firstName(trip.guest)} · ${vehicle}`;
      const cal = state.calendar();
      if (!cal.events.some((e) => e.source === src && e.start === trip.start)) {
        let googleId: string | undefined;
        if (googleConfigured()) {
          try {
            googleId = await calendarInsert({ title, start: trip.start, end: trip.end, location: trip.pickup ?? v?.pickup, notes: `Turo trip ${trip.id}\n${tripLink(s, trip)}`, timezone: tz });
          } catch (e) {
            journal({ kind: "system", source: src, summary: `Google Calendar insert failed for "${title}": ${(e as Error).message.slice(0, 200)}`, tags: ["turok", "calendar", "error"] });
          }
        }
        cal.events.push({ id: newId("cal"), title, start: trip.start, end: trip.end, location: trip.pickup ?? v?.pickup, notes: `Turo trip ${trip.id}`, source: src, createdAt: nowIso(), googleId });
        cal.events.sort((a, b) => a.start.localeCompare(b.start));
        cal.updatedAt = nowIso();
        state.saveCalendar(cal);
      }
      break;
    }
  }
  trip.lifecycle[step] = nowIso();
}

/** Recompute every car's prices and queue one set_price action per car when Turo needs updating. */
export function repriceFleet(s: TuroState, why: string): number {
  const c = turoConfig();
  const tz = ownerTz();
  const today = localDate(Date.now(), tz);
  let queued = 0;
  for (const v of s.vehicles.filter((x) => x.active)) {
    if (!v.basePrice) continue;
    const days = priceCalendar({ vehicle: v, today, booked: bookedDates(s.trips, v.id, tz), demand: s.demandEvents, rules: c.pricing });
    s.prices[v.id] = days;
    const changes = priceChanges(days, s.applied[v.id] ?? {}, c.pricing);
    const open = s.outbox.filter((a) => a.kind === "set_price" && a.vehicleId === v.id && a.status === "queued");
    const same = open.length === 1 && JSON.stringify((open[0].data as { days?: unknown })?.days) === JSON.stringify(changes);
    if (same) continue;
    open.forEach((a) => (a.status = "superseded"));
    if (!changes.length) continue;
    queueAction(s, {
      kind: "set_price",
      title: `Set ${changes.length} price(s) for ${v.name}`,
      body: priceLines(changes, c.currency).join("\n"),
      why,
      vehicleId: v.id,
      link: v.listingUrl ?? c.links?.turo,
      source: "turok:pricing",
      data: { days: changes },
    });
    queued++;
  }
  s.lastPricingAt = nowIso();
  return queued;
}

/** Every heartbeat: lifecycle messages, reminders, calendar, statuses; reprice once a day. No model needed. */
export async function turokTick(): Promise<void> {
  const s = loadTuro();
  if (!s.vehicles.length && !s.trips.length) {
    activity("turok", "idle", "no Turo cars or trips yet — they arrive from Turo emails in Gmail, or add cars in state/turo.json");
    return;
  }
  const tz = ownerTz();
  const c = turoConfig();
  const now = Date.now();
  let steps = 0;
  for (const trip of s.trips) {
    for (const step of dueSteps(trip, now, c.lifecycle)) {
      await lifecycleStep(s, trip, step, tz);
      steps++;
    }
  }
  let priced = 0;
  if (!s.lastPricingAt || now - Date.parse(s.lastPricingAt) > 20 * 3600_000) priced = repriceFleet(s, "Daily repricing: season, day of week, demand events, utilisation");
  saveTuro(s);
  activity("turok", "tick", `${steps} lifecycle step(s), ${priced} price update(s), ${s.outbox.filter((a) => a.status === "queued").length} open action(s)`);
}

/** Daily: look for demand-moving events near each car, then reprice. */
export async function turokPricing(): Promise<void> {
  const s = loadTuro();
  const priced = s.vehicles.filter((v) => v.active && v.basePrice);
  if (!priced.length) {
    activity("turok-pricing", "skipped", "no active Turo car has a basePrice yet");
    return;
  }
  const tz = ownerTz();
  const today = localDate(Date.now(), tz);
  const areas = [...new Set(priced.map((v) => v.pickup).filter(Boolean))];
  const t = turokTools("turok-pricing");
  const a = akiraTools("turok-pricing");
  const { text } = await runAgent({
    cycle: "turok-pricing",
    instructions: [
      turokSoul(),
      "",
      "## This turn: demand scan",
      `Search the web for events between ${today} and ${localDate(Date.now() + 60 * 86400_000, tz)} that raise or lower car-rental demand near the cars' pickup areas (default Toronto, Ontario): concerts, festivals, sports playoffs, conventions, long weekends, school breaks, major storms.`,
      "For each one that matters, call turo_add_demand_event with a multiplier (1.05 small, 1.15 notable, 1.3 major citywide; below 1 for demand drops) and the source URL. Skip events already known.",
      "Then finish with 2-4 lines on what you found. Prices are recomputed after you finish.",
    ].join("\n"),
    userContent: JSON.stringify({ areas: areas.length ? areas : ["Toronto, Ontario"], knownDemandEvents: s.demandEvents, cars: priced.map((v) => ({ id: v.id, name: v.name, basePrice: v.basePrice })) }, null, 1),
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 } as never, t.demand, a.logDecision],
    maxIterations: 20,
    effort: "medium",
  });
  const after = loadTuro();
  const n = repriceFleet(after, `Daily repricing with demand scan: ${text.slice(0, 200)}`);
  saveTuro(after);
  journal({ kind: "system", source: "turok-pricing", summary: `Turok pricing: ${n} car(s) need price updates. ${text.slice(0, 600)}`, tags: ["turok", "turo", "pricing"] });
  activity("turok-pricing", "priced", `${n} set_price action(s) queued`);
}
