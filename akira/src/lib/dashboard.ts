import path from "node:path";
import { PATHS } from "../config.js";
import { identity, journalCount, journalRecent, manifestCount, memory, nowIso, state, writeJson } from "./brain.js";
import type { Dashboard } from "./types.js";
import { loadTuro, turoConfig } from "./turo.js";

export const SCHEDULE = [
  { name: "heartbeat (Gmail, calendar, inbox, Turok, reminders)", every: "15 min" },
  { name: "turok-pricing (Turo demand scan + prices)", every: "06:20 local" },
  { name: "web-monitor", every: "hourly" },
  { name: "daily-brief", every: "07:00 local" },
  { name: "health-review", every: "Sunday" },
  { name: "compact-memory", every: "Sunday" },
];

export function buildDashboard(): Dashboard {
  const id = identity();
  const now = Date.now();
  const cal = state.calendar().events;
  const upcoming = cal.filter((e) => Date.parse(e.end ?? e.start) >= now - 3600_000).slice(0, 40);
  const reminders = state.reminders().items.filter((r) => !r.done).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 40);
  const act = state.activity().items;
  const devices = state.devices();
  const stale = id.devices?.staleAfterMinutes ?? 30;
  const working: string[] = [];
  for (const d of Object.values(devices.devices)) {
    if (d.lastSeen && now - Date.parse(d.lastSeen) > stale * 60_000) working.push(`${d.label} quiet for ${Math.round((now - Date.parse(d.lastSeen)) / 60_000)} min`);
  }
  const lastCycle = act[0];
  const status: Dashboard["assistant"]["status"] = lastCycle && now - Date.parse(lastCycle.ts) < 2 * 3600_000 ? "online" : "degraded";
  const turo = loadTuro();
  const dash: Dashboard = {
    generatedAt: nowIso(),
    assistant: { name: id.assistant.name, email: id.assistant.email, version: id.assistant.version, status },
    owner: { name: id.owner.name, timezone: id.owner.timezone },
    now: { lastCycle, nextCycles: SCHEDULE, working },
    counts: {
      journalEntries: journalCount(),
      documents: manifestCount(),
      calendarUpcoming: upcoming.length,
      remindersOpen: reminders.length,
      mentions: state.mentions().items.length,
      drafts: state.drafts().items.filter((d) => d.status === "draft").length,
      questions: state.questions().items.length,
    },
    calendar: upcoming,
    reminders,
    priorities: state.priorities(),
    health: { ...state.health(), daily: state.health().daily.slice(-30) },
    devices,
    mentions: { ...state.mentions(), items: state.mentions().items.slice(0, 30) },
    drafts: state.drafts().items.slice(0, 20),
    questions: state.questions().items.slice(0, 20),
    journalRecent: journalRecent(30),
    activity: act.slice(0, 60),
    memoryExcerpt: memory().slice(0, 4000),
    turo: {
      vehicles: turo.vehicles,
      trips: turo.trips.filter((t) => Date.parse(t.end) >= now - 3 * 86400_000 || t.status === "requested").slice(0, 30),
      outbox: turo.outbox.filter((a) => a.status === "queued").slice(0, 40),
      messages: turo.messages.slice(-20).reverse(),
      prices: Object.fromEntries(Object.entries(turo.prices).map(([k, v]) => [k, v.slice(0, 14)])),
      lastPricingAt: turo.lastPricingAt,
      currency: turoConfig().currency ?? "CAD",
    },
  };
  writeJson(path.join(PATHS.state, "dashboard.json"), dash);
  return dash;
}
