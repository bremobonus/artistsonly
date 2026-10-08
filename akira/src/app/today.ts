import { identity, journalRecent, manifestCount, memory, state } from "../lib/brain.js";

/** Everything going on, ranked. Deterministic: works with or without an API key. */
export function buildToday() {
  const id = identity();
  const tz = id.owner.timezone;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const in14 = new Date(Date.now() + 14 * 86400_000).toISOString();
  const cal = state.calendar().events.filter((e) => e.start.slice(0, 10) >= today && e.start < in14);
  const reminders = state.reminders().items.filter((r) => !r.done).sort((a, b) => a.due.localeCompare(b.due));
  const overdue = reminders.filter((r) => Date.parse(r.due) < Date.now());
  const pri = state.priorities();
  const recent = journalRecent(60).filter((e) => e.kind !== "event" || /received|sent|booked/i.test(e.summary)).slice(0, 25);
  const act = state.activity().items.slice(0, 8);
  const gaps: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) gaps.push("No ANTHROPIC_API_KEY in this environment: chat and thinking cycles are off until it is set.");
  if (!process.env.GOOGLE_REFRESH_TOKEN) gaps.push("Google not connected here: Gmail and Calendar sync are off (npm run google-auth).");
  return {
    generatedAt: new Date().toISOString(),
    today,
    timezone: tz,
    owner: id.owner.name,
    assistant: id.assistant,
    priorities: pri,
    calendar: cal,
    reminders,
    overdue,
    decisions: state.questions().items.slice(0, 10),
    mentions: state.mentions().items.slice(0, 10),
    devices: Object.values(state.devices().devices),
    health: state.health().latest,
    drafts: state.drafts().items.filter((d) => d.status === "draft").slice(0, 10),
    journal: recent,
    activity: act,
    documents: manifestCount(),
    gaps,
    memoryExcerpt: memory().slice(0, 3000),
  };
}
