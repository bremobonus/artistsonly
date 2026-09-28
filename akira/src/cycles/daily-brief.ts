import { activity, identity, journal, journalSince, state } from "../lib/brain.js";
import { runAgent } from "../lib/claude.js";
import { akiraTools } from "../tools.js";
import { email, push } from "../integrations/notify.js";

function localDate(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Morning brief: priorities, calendar, reminders, health, open questions, drafts. */
export async function dailyBrief(): Promise<void> {
  const id = identity();
  const today = localDate(id.owner.timezone);
  const cal = state.calendar().events.filter((e) => e.start.slice(0, 10) >= today).slice(0, 25);
  const rem = state.reminders().items.filter((r) => !r.done).slice(0, 30);
  const health = state.health();
  const q = state.questions().items.filter((x) => !x.answered).slice(0, 10);
  const drafts = state.drafts().items.filter((d) => d.status === "draft").slice(0, 10);
  const mentions = state.mentions().items.slice(0, 10);
  const recent = journalSince(2).filter((e) => e.kind !== "event").slice(0, 80);
  const prev = state.priorities();

  const t = akiraTools("daily-brief");
  const { text } = await runAgent({
    cycle: "daily-brief",
    instructions: [
      `Write Amos's brief for ${today}. First call set_priorities with 3-7 ranked items (carry over unfinished items from yesterday if still relevant, drop what no longer matters and say why in notes).`,
      "Then, if health data shows a trend worth noting, call health_flag once.",
      "Then write the brief as plain text, max ~200 words: 1) top priorities, 2) today's calendar, 3) reminders due, 4) health one-liner, 5) questions waiting on him, 6) drafts waiting for approval, 7) anything said about him online.",
      "Do not invent. If a section is empty, write 'nothing'.",
    ].join("\n"),
    userContent: JSON.stringify({ today, previousPriorities: prev, calendar: cal, reminders: rem, health: { latest: health.latest, last14: health.daily.slice(-14), flags: health.flags.slice(0, 5) }, questions: q, drafts, mentions, recentJournal: recent }, null, 1),
    tools: [t.setPriorities, t.healthFlag, t.setReminder, t.askAmos],
    maxIterations: 10,
  });
  journal({ kind: "system", source: "daily-brief", summary: `Brief ${today}: ${text.slice(0, 1500)}`, tags: ["brief"] });
  activity("daily-brief", "sent", `brief for ${today}`);
  await push(`Akira — brief for ${today}`, text.slice(0, 3800), 3);
  await email(`Akira — brief for ${today}`, text);
}
