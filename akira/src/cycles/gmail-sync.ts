import path from "node:path";
import { PATHS } from "../config.js";
import { activity, ensureDir, journal, newId, nowIso, readJson, writeJson } from "../lib/brain.js";
import { gmailAttachment, gmailMessage, gmailSearch, googleConfigured, parseGmailMessage } from "../integrations/google.js";
import type { IngestEvent } from "../lib/types.js";
import fs from "node:fs";

const STATE = path.join(PATHS.state, "gmail.json");
const MAX_ATTACHMENT = 4 * 1024 * 1024;

interface GmailState {
  lastEpoch: number;
  seen: string[];
  updatedAt: string;
}

/** Land an event in the local inbox (we are inside the Actions checkout; the heartbeat processes it next). */
function landLocal(ev: IngestEvent): void {
  ensureDir(PATHS.inbox);
  fs.writeFileSync(path.join(PATHS.inbox, `${ev.ts.replace(/[:.]/g, "-")}__${ev.source}__${ev.id}.json`), JSON.stringify(ev, null, 2) + "\n");
}

/** Pull new Gmail messages into Akira's inbox. Read-only scope. Attachments ≤4MB are archived. */
export async function gmailSync(): Promise<void> {
  if (!googleConfigured()) {
    activity("gmail-sync", "skipped", "Google not configured (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN)");
    return;
  }
  const st = readJson<GmailState>(STATE, { lastEpoch: Math.floor(Date.now() / 1000) - 7 * 86400, seen: [], updatedAt: "" });
  const ids = await gmailSearch(`after:${st.lastEpoch} -in:spam -in:trash`, 50);
  const fresh = ids.filter((id) => !st.seen.includes(id));
  let landed = 0;
  let maxEpoch = st.lastEpoch;
  for (const id of fresh.reverse()) {
    try {
      const m = parseGmailMessage(await gmailMessage(id));
      maxEpoch = Math.max(maxEpoch, Math.floor(Date.parse(m.ts) / 1000));
      const evId = `gmail_${m.id}`;
      landLocal({ id: evId, ts: m.ts, source: "email", device: "gmail", type: "inbound", payload: { from: m.from, to: m.to, subject: m.subject, messageId: m.messageId, threadId: m.threadId, text: m.text.slice(0, 200_000), attachmentNames: m.attachments.map((a) => a.filename) } });
      landed++;
      for (const a of m.attachments) {
        if (!a.attachmentId || a.size > MAX_ATTACHMENT) continue;
        const bytes = await gmailAttachment(m.id, a.attachmentId);
        landLocal({ id: newId("gatt"), ts: m.ts, source: "document", device: "gmail", type: "email-attachment", payload: { name: a.filename, contentType: a.mimeType, base64: bytes.toString("base64"), note: `Attachment on Gmail "${m.subject}" from ${m.from} (event ${evId})` } });
      }
      st.seen.push(id);
    } catch (e) {
      activity("gmail-sync", "error", `${id}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  st.seen = st.seen.slice(-500);
  // Keep a one-day overlap so late-arriving messages are not missed; `seen` prevents duplicates.
  st.lastEpoch = Math.max(st.lastEpoch, maxEpoch - 86400);
  st.updatedAt = nowIso();
  writeJson(STATE, st);
  if (landed) journal({ kind: "event", source: "gmail-sync", summary: `${landed} new Gmail message(s) landed in the inbox`, tags: ["email", "gmail"] });
  activity("gmail-sync", "synced", `${landed} new of ${ids.length} matched`);
}
