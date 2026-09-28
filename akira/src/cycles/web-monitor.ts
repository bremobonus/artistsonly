import { activity, identity, journal, state } from "../lib/brain.js";
import { runAgent } from "../lib/claude.js";
import { akiraTools } from "../tools.js";
import { push } from "../integrations/notify.js";

/** Search the web for what is being said about Amos and artistsonly.io. */
export async function webMonitor(): Promise<void> {
  const id = identity();
  const queries = id.monitoring?.webSearchQueries ?? [];
  if (!queries.length) {
    activity("web-monitor", "skipped", "no webSearchQueries in identity.json");
    return;
  }
  const known = state.mentions().items.slice(0, 200).map((m) => m.url);
  const t = akiraTools("web-monitor");
  const webSearch: Record<string, unknown> = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: Math.min(10, queries.length * 2),
  };
  if (id.monitoring.blockedDomains?.length) webSearch.blocked_domains = id.monitoring.blockedDomains;

  const before = state.mentions().items.length;
  const { text } = await runAgent({
    cycle: "web-monitor",
    instructions: [
      "Search the public web for mentions of Amos and artistsonly.io. Run each query below. Also try obvious variants (news, social, forums).",
      "For every result that is actually about Amos or artistsonly.io (not a namesake), call record_mention with the exact URL.",
      "Skip URLs already logged. Be neutral. Flag severity 'act' only for reputational, legal or safety issues.",
      "If nothing new is found, say so in one line.",
    ].join("\n"),
    userContent:
      "## Queries\n" + queries.map((q) => `- ${q}`).join("\n") + "\n\n## Already logged URLs\n" + (known.length ? known.map((u) => `- ${u}`).join("\n") : "(none)"),
    tools: [webSearch as never, t.recordMention],
    maxIterations: 25,
  });
  const after = state.mentions();
  after.lastRunAt = new Date().toISOString();
  state.saveMentions(after);
  const added = after.items.length - before;
  journal({ kind: "system", source: "web-monitor", summary: `Web sweep: ${added} new mention(s). ${text.slice(0, 500)}`, tags: ["web"] });
  activity("web-monitor", "swept", `${added} new mention(s)`);
  const urgent = after.items.slice(0, added).filter((m) => m.severity === "act");
  if (urgent.length) await push("Akira: web mention needs attention", urgent.map((m) => `${m.title} — ${m.url}`).join("\n"), 4);
}
