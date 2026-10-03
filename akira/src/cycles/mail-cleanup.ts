import path from "node:path";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { BRAIN, ENV, PATHS } from "../config.js";
import { activity, appendLine, journal, nowIso, readJson, writeJson } from "../lib/brain.js";
import { groupBulkSenders, parseHeaderBlock, parseMailto, type HeaderMessage, type SenderGroup } from "../lib/unsubscribe.js";

/**
 * Inbox cleanup for a Gmail account wired with an app password (IMAP + SMTP, no OAuth).
 * Finds bulk mail (anything carrying a List-Unsubscribe header), unsubscribes once per sender, then archives
 * those messages out of the Inbox under the label "Akira/Unsubscribed". Nothing is ever deleted or trashed:
 * every message stays in All Mail, and every action is appended to memory/raw/mail-cleanup/<account>.jsonl.
 *
 * Env: CLEANUP_GMAIL_ADDRESS, CLEANUP_GMAIL_APP_PASSWORD (16-char Google app password),
 *      CLEANUP_KEEP (comma list of domains/addresses never touched), CLEANUP_MAX_UNSUBSCRIBES (per run, default 150),
 *      CLEANUP_SCAN_LIMIT (newest Inbox messages scanned, default 20000). AKIRA_DRY_RUN=1 → report only.
 */

const LABEL = "Akira/Unsubscribed";

type Method = "one-click" | "mailto" | "manual-link" | "none";
type Status = "unsubscribed" | "needs-click" | "no-target" | "failed" | "kept";

interface SenderRecord {
  name: string;
  domain: string;
  seen: number;
  lastDate: string;
  sampleSubject: string;
  method: Method;
  status: Status;
  link?: string;
  error?: string;
  at: string;
}

interface CleanupState {
  account: string;
  senders: Record<string, SenderRecord>;
  archivedTotal: number;
  lastRun: string;
  lastSummary: string;
}

export function cleanupConfigured(): boolean {
  return !!(process.env.CLEANUP_GMAIL_ADDRESS && process.env.CLEANUP_GMAIL_APP_PASSWORD);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function oneClick(url: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Akira-unsubscribe/1.0" },
    body: "List-Unsubscribe=One-Click",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function mailCleanup(): Promise<void> {
  if (!cleanupConfigured()) {
    activity("mail-cleanup", "skipped", "CLEANUP_GMAIL_ADDRESS / CLEANUP_GMAIL_APP_PASSWORD not set");
    return;
  }
  const user = process.env.CLEANUP_GMAIL_ADDRESS!.trim();
  const pass = process.env.CLEANUP_GMAIL_APP_PASSWORD!.replace(/\s+/g, "");
  const keep = (process.env.CLEANUP_KEEP ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const maxUnsub = Number(process.env.CLEANUP_MAX_UNSUBSCRIBES ?? 150);
  const scanLimit = Number(process.env.CLEANUP_SCAN_LIMIT ?? 20000);
  const dry = ENV.dryRun;

  const stateFile = path.join(PATHS.state, "mail-cleanup", `${slug(user)}.json`);
  const auditFile = path.join(PATHS.raw, "mail-cleanup", `${slug(user)}.jsonl`);
  const audit = (rec: Record<string, unknown>) => appendLine(auditFile, JSON.stringify({ ts: nowIso(), account: user, ...rec }));
  const st = readJson<CleanupState>(stateFile, { account: user, senders: {}, archivedTotal: 0, lastRun: "", lastSummary: "" });

  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  const smtp = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });

  await client.connect();
  let groups: SenderGroup[] = [];
  let scanned = 0;
  let unsubscribed = 0;
  let needsClick = 0;
  let failed = 0;
  let archived = 0;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = typeof client.mailbox === "object" ? client.mailbox.exists : 0;
      if (total > 0) {
        const range = `${Math.max(1, total - scanLimit + 1)}:*`;
        const msgs: HeaderMessage[] = [];
        for await (const m of client.fetch(range, { uid: true, envelope: true, headers: ["list-unsubscribe", "list-unsubscribe-post"] })) {
          scanned++;
          const h = parseHeaderBlock(m.headers?.toString("utf8") ?? "");
          const f = m.envelope?.from?.[0];
          msgs.push({
            uid: m.uid,
            from: f ? `"${f.name ?? ""}" <${f.address ?? ""}>` : "",
            subject: m.envelope?.subject ?? "",
            date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : "",
            listUnsubscribe: h["list-unsubscribe"] ?? "",
            listUnsubscribePost: h["list-unsubscribe-post"] ?? "",
          });
        }
        groups = groupBulkSenders(msgs, keep);
      }

      let attempts = 0;
      for (const g of groups) {
        const prev = st.senders[g.address];
        const rec: SenderRecord = prev ?? { name: g.name, domain: g.domain, seen: 0, lastDate: "", sampleSubject: "", method: "none", status: "no-target", at: "" };
        rec.seen = Math.max(rec.seen, g.count);
        rec.lastDate = g.lastDate;
        rec.sampleSubject = g.sampleSubject;

        const done = prev && (prev.status === "unsubscribed" || prev.status === "needs-click");
        if (!done && attempts < maxUnsub && !dry) {
          attempts++;
          const t = g.targets;
          try {
            if (t.oneClick) {
              await oneClick(t.https[0]);
              Object.assign(rec, { method: "one-click", status: "unsubscribed", link: t.https[0], error: undefined });
            } else if (t.mailto.length) {
              const mt = parseMailto(t.mailto[0]);
              await smtp.sendMail({ from: user, to: mt.to, subject: mt.subject, text: mt.body });
              Object.assign(rec, { method: "mailto", status: "unsubscribed", link: t.mailto[0], error: undefined });
            } else if (t.https.length) {
              Object.assign(rec, { method: "manual-link", status: "needs-click", link: t.https[0] });
            } else {
              Object.assign(rec, { method: "none", status: "no-target" });
            }
          } catch (e) {
            Object.assign(rec, { status: "failed", error: (e as Error).message.slice(0, 200), link: t.https[0] ?? t.mailto[0] });
          }
          rec.at = nowIso();
          audit({ action: "unsubscribe", sender: g.address, name: g.name, method: rec.method, status: rec.status, link: rec.link, error: rec.error, messages: g.count });
        }
        if (rec.status === "unsubscribed") unsubscribed++;
        if (rec.status === "needs-click") needsClick++;
        if (rec.status === "failed") failed++;
        st.senders[g.address] = rec;

        // Archive (remove the Inbox label, add ours). Messages remain in All Mail — never deleted.
        if (!dry && rec.status !== "failed" && g.uids.length) {
          await client.messageFlagsAdd(g.uids, [LABEL], { uid: true, useLabels: true });
          await client.messageFlagsRemove(g.uids, ["\\Inbox"], { uid: true, useLabels: true });
          archived += g.uids.length;
          audit({ action: "archive", sender: g.address, label: LABEL, uids: g.uids });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
    smtp.close();
  }

  st.archivedTotal += archived;
  st.lastRun = nowIso();
  st.lastSummary = `${dry ? "[dry run] " : ""}scanned ${scanned} Inbox messages; ${groups.length} bulk senders; ${unsubscribed} unsubscribed, ${needsClick} need a click, ${failed} failed; archived ${archived} (label ${LABEL}, nothing deleted)`;
  writeJson(stateFile, st);
  journal({
    kind: "decision",
    source: "mail-cleanup",
    summary: `Inbox cleanup for ${user}: ${st.lastSummary}`,
    tags: ["email", "cleanup", "unsubscribe"],
    refs: [path.relative(BRAIN, auditFile)],
  });
  activity("mail-cleanup", dry ? "dry-run" : "cleaned", st.lastSummary);
}
