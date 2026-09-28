import fs from "node:fs";
import { PATHS } from "../config.js";
import { activity, journal, journalSince, memory } from "../lib/brain.js";
import { runAgent } from "../lib/claude.js";

/**
 * Weekly: rewrite MEMORY.md for clarity. Facts are never lost: everything removed already lives in
 * the journal, and the previous MEMORY.md is journaled in full before the rewrite (retention rule 4).
 */
export async function compactMemory(): Promise<void> {
  const before = memory();
  const { text } = await runAgent({
    cycle: "compact-memory",
    instructions: [
      "Rewrite MEMORY.md. Keep every fact (merge duplicates, fix ordering, keep sources). Keep the section structure.",
      "Add anything important from the last 14 days of journal that is missing. Update 'Last compaction' to today.",
      "Output ONLY the new markdown for MEMORY.md, nothing else.",
    ].join("\n"),
    userContent: "## Journal, last 14 days (non-raw)\n" + JSON.stringify(journalSince(14).filter((e) => e.kind !== "event").slice(0, 400), null, 1),
    tools: [],
    maxIterations: 2,
    effort: "high",
  });
  if (text.length < before.length * 0.5 || !text.startsWith("# Akira")) {
    activity("compact-memory", "rejected", `new memory too short or malformed (${text.length} chars)`);
    return;
  }
  journal({ kind: "system", source: "compact-memory", summary: "MEMORY.md compacted. Previous version preserved in data.", data: { previous: before }, tags: ["compaction"] });
  fs.writeFileSync(PATHS.memory, text.trimEnd() + "\n");
  activity("compact-memory", "rewritten", `${before.length} -> ${text.length} chars`);
}
