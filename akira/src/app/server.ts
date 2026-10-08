#!/usr/bin/env node
/**
 * Akira, local app. `npm run app` then open http://localhost:4747
 * Chat with Akira (she uses all her tools), see Today (everything going on, ranked), tick priorities.
 * Every message is recorded in brain/memory/conversations/<date>.jsonl and journaled. Sync pushes the brain to GitHub.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { AKIRA_ROOT, BRAIN, PATHS } from "../config.js";
import { activity, appendLine, ensureDir, journal, nowIso, readText, state } from "../lib/brain.js";
import { runAgent } from "../lib/claude.js";
import { akiraTools } from "../tools.js";
import { buildToday } from "./today.js";
import { buildDashboard } from "../lib/dashboard.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.AKIRA_PORT ?? 4747);
const CONV_DIR = path.join(BRAIN, "memory", "conversations");
const localDate = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

interface Turn { ts: string; role: "user" | "assistant"; text: string }

function convFile(date = localDate()): string {
  return path.join(CONV_DIR, `${date}.jsonl`);
}
function readTurns(date = localDate(), limit = 60): Turn[] {
  const lines = readText(convFile(date)).trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((l) => JSON.parse(l) as Turn);
}
function record(role: Turn["role"], text: string): Turn {
  const t: Turn = { ts: nowIso(), role, text };
  appendLine(convFile(), JSON.stringify(t));
  return t;
}

async function chat(message: string): Promise<string> {
  const history: Anthropic.Beta.BetaMessageParam[] = readTurns(localDate(), 40).map((t) => ({ role: t.role, content: t.text }));
  record("user", message);
  journal({ kind: "event", source: "akira-app", summary: `Amos: ${message.slice(0, 400)}`, tags: ["chat", "amos"] });
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    const reply = "I'm recording this, but I can't think yet: ANTHROPIC_API_KEY is not set in this terminal. Start me with `ANTHROPIC_API_KEY=... npm run app`.";
    record("assistant", reply);
    return reply;
  }
  const t = akiraTools("chat");
  const { text } = await runAgent({
    cycle: "chat",
    instructions: [
      "You are talking with Amos directly in the Akira app. Be brief and useful. Act with your tools when something should be remembered, scheduled, reminded, emailed, prioritised or decided; say what you did in one line.",
      "The Today panel beside this chat shows state/priorities.json, calendar, reminders and the journal; when Amos asks what is going on or what to do, answer from that state (it is included below) and use set_priorities to change the ranking.",
      "## Today state\n" + JSON.stringify(buildToday(), null, 0).slice(0, 60_000),
    ].join("\n"),
    userContent: message,
    history,
    tools: [t.remember, t.notePerson, t.setReminder, t.addCalendarEvent, t.sendEmail, t.draftEmail, t.setPriorities, t.logDecision, t.healthFlag],
    maxIterations: 20,
  });
  const reply = text || "(no reply)";
  record("assistant", reply);
  journal({ kind: "event", source: "akira-app", summary: `Akira: ${reply.slice(0, 400)}`, tags: ["chat", "akira"] });
  buildDashboard();
  return reply;
}

function runCycle(name: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("npx", ["tsx", "src/index.ts", name], { cwd: AKIRA_ROOT, env: process.env, timeout: 15 * 60_000 }, (err, stdout, stderr) => {
      resolve((stdout + stderr).slice(-4000) + (err ? `\n[exit ${err.code ?? "?"}]` : ""));
    });
  });
}

function sync(): Promise<string> {
  return new Promise((resolve) => {
    const repo = path.resolve(AKIRA_ROOT, "..");
    const cmd = `git add akira/brain && (git diff --cached --quiet && echo "nothing to sync" || (git commit -q -m "[akira] local app $(date -u +%Y-%m-%dT%H:%MZ)" && git pull -q --rebase origin main && git push -q origin HEAD:main && echo "synced"))`;
    execFile("bash", ["-lc", cmd], { cwd: repo, env: process.env, timeout: 120_000 }, (err, stdout, stderr) => resolve((stdout + stderr).trim() || (err ? String(err) : "ok")));
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

ensureDir(CONV_DIR);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  // Local only: refuse anything that is not loopback.
  const addr = req.socket.remoteAddress ?? "";
  if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(addr)) return json(res, 403, { error: "local only" });
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(here, "index.html")));
    }
    if (req.method === "GET" && url.pathname === "/api/today") return json(res, 200, buildToday());
    if (req.method === "GET" && url.pathname === "/api/history") return json(res, 200, { date: localDate(), turns: readTurns() });
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const b = await body(req);
      const message = String(b.message ?? "").trim();
      if (!message) return json(res, 400, { error: "empty" });
      return json(res, 200, { reply: await chat(message) });
    }
    if (req.method === "POST" && url.pathname === "/api/priority") {
      const b = await body(req);
      const p = state.priorities();
      const item = p.items.find((x) => x.rank === Number(b.rank));
      if (!item) return json(res, 404, { error: "no such priority" });
      item.status = String(b.status) as typeof item.status;
      p.updatedAt = nowIso();
      state.savePriorities(p);
      journal({ kind: "decision", source: "akira-app", summary: `Amos marked priority ${item.rank} "${item.text.slice(0, 80)}" as ${item.status}`, tags: ["priorities", "amos"] });
      return json(res, 200, p);
    }
    if (req.method === "POST" && url.pathname === "/api/reminder") {
      const b = await body(req);
      const r = state.reminders();
      const item = r.items.find((x) => x.id === String(b.id));
      if (!item) return json(res, 404, { error: "no such reminder" });
      item.done = Boolean(b.done);
      r.updatedAt = nowIso();
      state.saveReminders(r);
      journal({ kind: "event", source: "akira-app", summary: `Reminder ${item.done ? "done" : "reopened"}: ${item.text.slice(0, 100)}`, tags: ["reminder", "amos"] });
      return json(res, 200, r);
    }
    if (req.method === "POST" && url.pathname === "/api/cycle") {
      const b = await body(req);
      const name = String(b.name ?? "heartbeat");
      if (!/^[a-z-]+$/.test(name)) return json(res, 400, { error: "bad cycle" });
      const out = await runCycle(name);
      return json(res, 200, { out });
    }
    if (req.method === "POST" && url.pathname === "/api/sync") return json(res, 200, { out: await sync() });
    json(res, 404, { error: "not found" });
  } catch (e) {
    activity("app", "error", (e as Error).message.slice(0, 300));
    json(res, 500, { error: (e as Error).message });
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Akira is at http://localhost:${PORT}  (brain: ${BRAIN})`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("ANTHROPIC_API_KEY is not set: chat will record but not think.");
});
