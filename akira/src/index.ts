#!/usr/bin/env node
import { activity, journal } from "./lib/brain.js";
import { buildDashboard } from "./lib/dashboard.js";
import { calendarSync } from "./cycles/calendar-sync.js";
import { remindersDue } from "./cycles/reminders.js";
import { processInbox } from "./cycles/process-inbox.js";
import { webMonitor } from "./cycles/web-monitor.js";
import { dailyBrief } from "./cycles/daily-brief.js";
import { healthReview } from "./cycles/health.js";
import { compactMemory } from "./cycles/compact-memory.js";
import { gmailSync } from "./cycles/gmail-sync.js";

const cycles: Record<string, () => Promise<void>> = {
  "calendar-sync": calendarSync,
  reminders: remindersDue,
  "gmail-sync": gmailSync,
  "process-inbox": processInbox,
  "web-monitor": webMonitor,
  "daily-brief": dailyBrief,
  "health-review": healthReview,
  "compact-memory": compactMemory,
  dashboard: async () => {
    buildDashboard();
  },
  heartbeat: async () => {
    await calendarSync();
    await gmailSync();
    await processInbox();
    await remindersDue();
  },
};

async function main() {
  const names = process.argv.slice(2);
  if (!names.length || names.includes("--help")) {
    console.log("usage: akira <cycle> [cycle...]\ncycles: " + Object.keys(cycles).join(", "));
    process.exit(names.length ? 0 : 1);
  }
  let failed = 0;
  for (const name of names) {
    const fn = cycles[name];
    if (!fn) {
      console.error(`unknown cycle: ${name}`);
      failed++;
      continue;
    }
    const started = Date.now();
    try {
      await fn();
      activity(name, "ok", `${Date.now() - started} ms`);
    } catch (e) {
      failed++;
      const msg = (e as Error).stack ?? String(e);
      activity(name, "failed", msg.slice(0, 500));
      journal({ kind: "system", source: name, summary: `Cycle failed: ${msg.slice(0, 500)}`, tags: ["error"] });
    }
  }
  buildDashboard();
  process.exit(failed ? 1 : 0);
}

main();
