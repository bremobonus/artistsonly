import { activity, journal, state } from "../lib/brain.js";
import { runAgent } from "../lib/claude.js";
import { akiraTools } from "../tools.js";

/** Weekly deeper look at health trends. Daily flags are handled by daily-brief. */
export async function healthReview(): Promise<void> {
  const h = state.health();
  if (!h.daily.length) {
    activity("health-review", "skipped", "no health data yet");
    return;
  }
  const t = akiraTools("health-review");
  const { text } = await runAgent({
    cycle: "health-review",
    instructions: [
      "Review the last 90 days of Apple Health data. Look for trends in sleep, resting heart rate, HRV, steps, exercise.",
      "Call health_flag for each notable trend (watch) or concerning change (concern). Be specific with numbers and dates. Do not diagnose.",
      "If a trend suggests a habit change, call set_reminder with a gentle, concrete nudge at a sensible time.",
      "End with a 3-5 line summary.",
    ].join("\n"),
    userContent: JSON.stringify({ last90: h.daily.slice(-90), existingFlags: h.flags.slice(0, 20) }, null, 1),
    tools: [t.healthFlag, t.setReminder, t.remember],
    maxIterations: 12,
  });
  journal({ kind: "health", source: "health-review", summary: text.slice(0, 1500), tags: ["health", "review"] });
  activity("health-review", "reviewed", `${h.daily.length} day(s) of data`);
}
