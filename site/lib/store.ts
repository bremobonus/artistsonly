/**
 * The brain lives in the git repo. The site reads state from it and lands new events in
 * akira/brain/memory/inbox/ through the GitHub Contents API. Every write is a commit, so every
 * event is part of the permanent record. In local dev with AKIRA_LOCAL_BRAIN=1 it uses the filesystem.
 */
import fs from "node:fs";
import path from "node:path";
import type { IngestEvent, IngestSource } from "./akira-types";

const REPO = process.env.AKIRA_REPO ?? "bremobonus/artistsonly";
const BRANCH = process.env.AKIRA_BRANCH ?? "main";
const TOKEN = process.env.GITHUB_TOKEN;
const LOCAL = process.env.AKIRA_LOCAL_BRAIN === "1";
const LOCAL_ROOT = path.resolve(process.cwd(), "..", "akira");

const api = (p: string) => `https://api.github.com/repos/${REPO}/${p}`;
const ghHeaders = (accept = "application/vnd.github+json") => ({
  Authorization: `Bearer ${TOKEN}`,
  Accept: accept,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "akira-site",
});

export async function readBrainFile(rel: string, revalidateSeconds = 30): Promise<string | null> {
  if (LOCAL) {
    try {
      return fs.readFileSync(path.join(LOCAL_ROOT, rel), "utf8");
    } catch {
      return null;
    }
  }
  if (!TOKEN) return null;
  const res = await fetch(api(`contents/akira/${rel}?ref=${encodeURIComponent(BRANCH)}`), {
    headers: ghHeaders("application/vnd.github.raw+json"),
    next: { revalidate: revalidateSeconds },
  });
  if (!res.ok) return null;
  return res.text();
}

export async function readBrainJson<T>(rel: string, fallback: T, revalidateSeconds = 30): Promise<T> {
  const txt = await readBrainFile(rel, revalidateSeconds);
  if (!txt) return fallback;
  try {
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
}

async function commitFile(rel: string, content: Buffer, message: string): Promise<{ ok: boolean; status: number; detail?: string }> {
  if (LOCAL) {
    const abs = path.join(LOCAL_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return { ok: true, status: 200 };
  }
  if (!TOKEN) return { ok: false, status: 500, detail: "GITHUB_TOKEN not configured" };
  const res = await fetch(api(`contents/akira/${rel}`), {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: content.toString("base64"), branch: BRANCH, committer: { name: "Akira", email: "akira@artistsonly.io" } }),
  });
  return { ok: res.ok, status: res.status, detail: res.ok ? undefined : (await res.text()).slice(0, 300) };
}

const SOURCES: IngestSource[] = ["apple_health", "device", "conversation", "email", "note", "document", "calendar", "web", "location", "turo", "system"];

export function normaliseEvent(input: unknown, defaults: Partial<IngestEvent> = {}): IngestEvent | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const source = (o.source ?? defaults.source) as IngestSource | undefined;
  if (!source || !SOURCES.includes(source)) return null;
  const ts = typeof o.ts === "string" && !isNaN(Date.parse(o.ts)) ? new Date(o.ts).toISOString() : new Date().toISOString();
  const rand = Math.random().toString(36).slice(2, 8);
  const id = typeof o.id === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(o.id) ? o.id : `ev_${Date.now().toString(36)}_${rand}`;
  return {
    id,
    ts,
    source,
    device: typeof o.device === "string" ? o.device.slice(0, 60) : defaults.device,
    type: typeof o.type === "string" ? o.type.slice(0, 60) : defaults.type,
    payload: o.payload ?? o.data ?? (({ id: _i, ts: _t, source: _s, device: _d, type: _y, ...rest }) => rest)(o),
  };
}

/** Land an event in the inbox. One file per event: no write conflicts, nothing overwritten. */
export async function landEvent(ev: IngestEvent): Promise<{ ok: boolean; status: number; detail?: string; path: string }> {
  const safeTs = ev.ts.replace(/[:.]/g, "-");
  const rel = `brain/memory/inbox/${safeTs}__${ev.source}__${ev.id}.json`;
  const r = await commitFile(rel, Buffer.from(JSON.stringify(ev, null, 2) + "\n"), `[akira] ingest ${ev.source}${ev.device ? ` from ${ev.device}` : ""} (${ev.id})`);
  return { ...r, path: rel };
}
