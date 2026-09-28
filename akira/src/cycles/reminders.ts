import { activity, journal, nowIso, state } from "../lib/brain.js";
import { push } from "../integrations/notify.js";

/** Fire reminders that are due and not yet notified. Deterministic, no LLM. */
export async function remindersDue(): Promise<void> {
  const r = state.reminders();
  const now = Date.now();
  let fired = 0;
  for (const item of r.items) {
    if (item.done || item.notifiedAt) continue;
    if (Date.parse(item.due) <= now) {
      const ok = await push(`Reminder: ${item.text}`, `Due ${item.due} (${item.priority})`, item.priority === "urgent" ? 5 : item.priority === "high" ? 4 : 3);
      item.notifiedAt = nowIso();
      fired++;
      journal({ kind: "event", source: "reminders", summary: `Reminder fired: ${item.text}${ok ? "" : " (push not configured)"}`, refs: [item.id], tags: ["reminder"] });
    }
  }
  if (fired) {
    r.updatedAt = nowIso();
    state.saveReminders(r);
  }
  activity("reminders", "checked", `${fired} fired, ${r.items.filter((x) => !x.done).length} open`);
}
