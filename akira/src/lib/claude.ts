import Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { MODEL } from "../config.js";
import { identity, memory, peopleAndProjects, soul } from "./brain.js";

let _client: Anthropic | undefined;
export function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

/** Stable system prompt (cached) followed by volatile context. */
export function systemBlocks(extra: string): Anthropic.Beta.BetaTextBlockParam[] {
  const id = identity();
  const stable = [
    soul(),
    "",
    "## Identity",
    "```json",
    JSON.stringify({ assistant: id.assistant, owner: id.owner }, null, 2),
    "```",
  ].join("\n");
  const volatile = [
    "## Long-term memory (MEMORY.md)",
    memory(),
    "",
    "## People and projects",
    peopleAndProjects(),
    "",
    extra,
  ].join("\n");
  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: volatile },
  ];
}

export interface RunOpts {
  cycle: string;
  instructions: string;
  userContent: string;
  tools: Array<BetaRunnableTool<any> | Anthropic.Beta.BetaToolUnion>;
  maxIterations?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * Run one agentic turn with the SDK tool runner. Server tools (web search) may pause the turn;
 * the runner does not auto-resume, so we push the paused assistant turn back and keep going.
 */
export async function runAgent(opts: RunOpts): Promise<{ text: string; message: Anthropic.Beta.BetaMessage }> {
  const c = client();
  const runner = c.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    system: systemBlocks(`## Cycle: ${opts.cycle}\n${opts.instructions}\nCurrent time: ${new Date().toISOString()}`),
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "high" },
    tools: opts.tools as Anthropic.Beta.BetaToolUnion[] as any,
    messages: [{ role: "user", content: opts.userContent }],
    max_iterations: opts.maxIterations ?? 12,
  });

  let last: Anthropic.Beta.BetaMessage | undefined;
  for await (const message of runner) {
    last = message;
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
    if (message.stop_reason === "refusal") {
      console.warn(`[akira:${opts.cycle}] model declined:`, message.stop_details?.explanation ?? "");
      break;
    }
  }
  const final = last ?? (await runner.done());
  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { text, message: final };
}
