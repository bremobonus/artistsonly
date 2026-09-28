import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PATHS } from "../config.js";
import type {
  ActivityItem,
  CalendarEvent,
  DevicesState,
  DraftMeta,
  HealthState,
  IngestEvent,
  JournalEntry,
  MentionsState,
  Priorities,
  Question,
  Reminder,
} from "./types.js";

// ---------- low-level fs ----------

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export function readText(file: string, fallback = ""): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

export function appendLine(file: string, line: string): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, line.replace(/\n/g, " ") + "\n");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

export function dateOf(ts: string): string {
  return ts.slice(0, 10);
}

// ---------- identity / memory ----------

export interface Identity {
  assistant: { name: string; email: string; site: string; dashboard: string; version: string; born: string };
  owner: {
    name: string;
    fullName: string;
    aliases: string[];
    emails: string[];
    timezone: string;
    locale: string;
    quietHours: { start: string; end: string };
  };
  monitoring: { webSearchQueries: string[]; watchDomains: string[]; blockedDomains: string[] };
  devices: { expected: Array<{ id: string; label: string; kind: string }>; staleAfterMinutes: number };
  calendars: { subscribedIcsUrls: string[] };
  notify: { ntfyTopic: string; emailTo: string };
}

export function identity(): Identity {
  return readJson<Identity>(PATHS.identity, {} as Identity);
}

export function soul(): string {
  return readText(PATHS.soul);
}

export function memory(): string {
  return readText(PATHS.memory);
}

export function rememberLongTerm(section: string, line: string): void {
  // Append under a section header in MEMORY.md; create the section if missing.
  let md = memory();
  const header = `## ${section}`;
  const entry = `- ${line}`;
  if (md.includes(header)) {
    const idx = md.indexOf(header) + header.length;
    const nextHeader = md.indexOf("\n## ", idx);
    const end = nextHeader === -1 ? md.length : nextHeader;
    md = md.slice(0, end).replace(/\s*$/, "") + "\n" + entry + "\n" + (nextHeader === -1 ? "" : md.slice(end));
  } else {
    md = md.replace(/\s*$/, "") + `\n\n${header}\n${entry}\n`;
  }
  fs.writeFileSync(PATHS.memory, md);
}

export function peopleAndProjects(): string {
  const chunks: string[] = [];
  for (const dir of [PATHS.people, PATHS.projects]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
      chunks.push(`### ${path.basename(dir)}/${f}\n${readText(path.join(dir, f))}`);
    }
  }
  return chunks.join("\n\n");
}

export function appendPersonNote(slug: string, line: string): void {
  const file = path.join(PATHS.people, `${slug}.md`);
  if (!fs.existsSync(file)) {
    ensureDir(PATHS.people);
    fs.writeFileSync(file, `# ${slug}\n\n`);
  }
  fs.appendFileSync(file, `- ${line}\n`);
}

// ---------- journal (append-only) ----------

export function journal(entry: Omit<JournalEntry, "id" | "ts"> & { ts?: string }): JournalEntry {
  const ts = entry.ts ?? nowIso();
  const full: JournalEntry = { id: newId("j"), ts, ...entry };
  appendLine(path.join(PATHS.journal, `${dateOf(ts)}.jsonl`), JSON.stringify(full));
  return full;
}

export function journalRecent(limit = 40): JournalEntry[] {
  if (!fs.existsSync(PATHS.journal)) return [];
  const files = fs.readdirSync(PATHS.journal).filter((f) => f.endsWith(".jsonl")).sort().reverse();
  const out: JournalEntry[] = [];
  for (const f of files) {
    const lines = readText(path.join(PATHS.journal, f)).trim().split("\n").filter(Boolean).reverse();
    for (const l of lines) {
      try {
        out.push(JSON.parse(l));
      } catch {
        /* skip corrupt line, never delete it */
      }
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function journalCount(): number {
  if (!fs.existsSync(PATHS.journal)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(PATHS.journal)) {
    if (!f.endsWith(".jsonl")) continue;
    n += readText(path.join(PATHS.journal, f)).split("\n").filter(Boolean).length;
  }
  return n;
}

export function journalSince(days: number): JournalEntry[] {
  const cutoff = Date.now() - days * 86400_000;
  return journalRecent(5000).filter((e) => Date.parse(e.ts) >= cutoff);
}

// ---------- inbox / raw ----------

export function listInbox(): Array<{ file: string; event: IngestEvent }> {
  if (!fs.existsSync(PATHS.inbox)) return [];
  return fs
    .readdirSync(PATHS.inbox)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const file = path.join(PATHS.inbox, f);
      return { file, event: readJson<IngestEvent>(file, null as unknown as IngestEvent) };
    })
    .filter((x) => x.event && x.event.id);
}

/** Move a processed inbox file into raw/YYYY/MM/DD/. Nothing is ever deleted. */
export function archiveRaw(file: string, event: IngestEvent): string {
  const d = dateOf(event.ts || nowIso());
  const dir = path.join(PATHS.raw, d.slice(0, 4), d.slice(5, 7), d.slice(8, 10));
  ensureDir(dir);
  const dest = path.join(dir, path.basename(file));
  fs.renameSync(file, dest);
  return path.relative(PATHS.raw, dest);
}

// ---------- state ----------

const stateFile = (name: string) => path.join(PATHS.state, `${name}.json`);

export const state = {
  calendar: () => readJson<{ events: CalendarEvent[]; updatedAt: string }>(stateFile("calendar"), { events: [], updatedAt: "" }),
  saveCalendar: (v: { events: CalendarEvent[]; updatedAt: string }) => writeJson(stateFile("calendar"), v),
  reminders: () => readJson<{ items: Reminder[]; updatedAt: string }>(stateFile("reminders"), { items: [], updatedAt: "" }),
  saveReminders: (v: { items: Reminder[]; updatedAt: string }) => writeJson(stateFile("reminders"), v),
  priorities: () => readJson<Priorities>(stateFile("priorities"), { date: "", items: [], notes: "", updatedAt: "" }),
  savePriorities: (v: Priorities) => writeJson(stateFile("priorities"), v),
  health: () => readJson<HealthState>(stateFile("health"), { latest: {}, daily: [], flags: [], updatedAt: "" }),
  saveHealth: (v: HealthState) => writeJson(stateFile("health"), v),
  devices: () => readJson<DevicesState>(stateFile("devices"), { devices: {}, updatedAt: "" }),
  saveDevices: (v: DevicesState) => writeJson(stateFile("devices"), v),
  mentions: () => readJson<MentionsState>(stateFile("mentions"), { items: [], updatedAt: "" }),
  saveMentions: (v: MentionsState) => writeJson(stateFile("mentions"), v),
  drafts: () => readJson<{ items: DraftMeta[]; updatedAt: string }>(stateFile("drafts-index"), { items: [], updatedAt: "" }),
  saveDrafts: (v: { items: DraftMeta[]; updatedAt: string }) => writeJson(stateFile("drafts-index"), v),
  questions: () => readJson<{ items: Question[]; updatedAt: string }>(stateFile("questions"), { items: [], updatedAt: "" }),
  saveQuestions: (v: { items: Question[]; updatedAt: string }) => writeJson(stateFile("questions"), v),
  activity: () => readJson<{ items: ActivityItem[] }>(stateFile("activity"), { items: [] }),
  saveActivity: (v: { items: ActivityItem[] }) => writeJson(stateFile("activity"), v),
};

export function activity(cycle: string, action: string, detail: string): void {
  const a = state.activity();
  a.items.unshift({ ts: nowIso(), cycle, action, detail });
  a.items = a.items.slice(0, 300);
  state.saveActivity(a);
  console.log(`[akira:${cycle}] ${action} — ${detail}`);
}

// ---------- documents / manifest ----------

export interface ManifestLine {
  id: string;
  sha256: string;
  bytes: number;
  originalName: string;
  storedAs: string;
  source: string;
  receivedAt: string;
  handler: string;
  notes?: string;
}

export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function manifestAdd(line: Omit<ManifestLine, "id">): ManifestLine {
  const full: ManifestLine = { id: newId("doc"), ...line };
  appendLine(PATHS.manifest, JSON.stringify(full));
  return full;
}

export function manifestCount(): number {
  return readText(PATHS.manifest).split("\n").filter(Boolean).length;
}

/** Store bytes in documents/incoming with a chain-of-custody manifest line. */
export function storeDocument(opts: {
  bytes: Buffer;
  originalName: string;
  source: string;
  receivedAt?: string;
  handler?: string;
  notes?: string;
}): ManifestLine {
  ensureDir(PATHS.documentsIncoming);
  const receivedAt = opts.receivedAt ?? nowIso();
  const sha = crypto.createHash("sha256").update(opts.bytes).digest("hex");
  const safeName = opts.originalName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  const storedAs = `${receivedAt.replace(/[:]/g, "-")}__${sha.slice(0, 12)}__${safeName}`;
  const dest = path.join(PATHS.documentsIncoming, storedAs);
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, opts.bytes);
  return manifestAdd({
    sha256: sha,
    bytes: opts.bytes.length,
    originalName: opts.originalName,
    storedAs: `documents/incoming/${storedAs}`,
    source: opts.source,
    receivedAt,
    handler: opts.handler ?? "akira",
    notes: opts.notes,
  });
}

// ---------- drafts ----------

export function saveDraft(d: { to: string; subject: string; body: string; why: string; source: string }): DraftMeta {
  ensureDir(PATHS.drafts);
  const id = newId("draft");
  const file = `${id}.md`;
  const md = `---\nid: ${id}\nto: ${d.to}\nsubject: ${d.subject}\nstatus: draft\ncreated: ${nowIso()}\nwhy: ${d.why}\nsource: ${d.source}\n---\n\n${d.body}\n`;
  fs.writeFileSync(path.join(PATHS.drafts, file), md);
  const idx = state.drafts();
  const meta: DraftMeta = { id, to: d.to, subject: d.subject, file: `state/drafts/${file}`, status: "draft", createdAt: nowIso(), why: d.why };
  idx.items.unshift(meta);
  idx.updatedAt = nowIso();
  state.saveDrafts(idx);
  return meta;
}
