import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the brain at a temp copy so tests never touch the real memory.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "akira-"));
fs.cpSync(path.resolve(import.meta.dirname, "../brain"), path.join(tmp, "brain"), { recursive: true });
fs.copyFileSync(path.resolve(import.meta.dirname, "../SOUL.md"), path.join(tmp, "SOUL.md"));
process.env.AKIRA_ROOT = tmp;

const brain = await import("../src/lib/brain.js");
const { parseIcs } = await import("../src/cycles/calendar-sync.js");
const { buildDashboard } = await import("../src/lib/dashboard.js");

test("journal is append-only and readable", () => {
  const before = brain.journalCount();
  const e = brain.journal({ kind: "fact", source: "test", summary: "hello" });
  assert.equal(brain.journalCount(), before + 1);
  assert.equal(brain.journalRecent(1)[0].id, e.id);
});

test("rememberLongTerm appends under section", () => {
  brain.rememberLongTerm("Test Section", "a fact");
  brain.rememberLongTerm("Test Section", "another fact");
  const md = brain.memory();
  assert.match(md, /## Test Section\n- a fact\n- another fact/);
});

test("storeDocument writes file and manifest with sha256", () => {
  const m = brain.storeDocument({ bytes: Buffer.from("contract"), originalName: "c.txt", source: "test" });
  assert.equal(m.sha256.length, 64);
  assert.equal(brain.manifestCount(), 1);
  assert.ok(fs.existsSync(path.join(tmp, "brain", m.storedAs)));
});

test("parseIcs handles all-day and timed events", () => {
  const ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1\nSUMMARY:Show\nDTSTART:20261001T190000Z\nDTEND:20261001T210000Z\nEND:VEVENT\nBEGIN:VEVENT\nUID:2\nSUMMARY:Day\nDTSTART;VALUE=DATE:20261002\nEND:VEVENT\nEND:VCALENDAR";
  const ev = parseIcs(ics, "t");
  assert.equal(ev.length, 2);
  assert.equal(ev[0].start, "2026-10-01T19:00:00Z");
  assert.equal(ev[1].allDay, true);
});

test("dashboard builds from empty state", () => {
  const d = buildDashboard();
  assert.equal(d.assistant.name, "Akira");
  assert.ok(d.counts.journalEntries >= 1);
});

test("parseGmailMessage extracts headers, text body and attachments", async () => {
  const { parseGmailMessage } = await import("../src/integrations/google.js");
  const b64 = (s: string) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  const m = parseGmailMessage({
    id: "m1", threadId: "t1", internalDate: "1790600000000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [{ name: "From", value: "Jane <jane@example.com>" }, { name: "Subject", value: "Invoice" }, { name: "To", value: "amos@example.com" }],
      parts: [
        { mimeType: "text/plain", body: { data: b64("Please pay by Oct 15.") } },
        { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att1", size: 1234 } },
      ],
    },
  });
  assert.equal(m.from, "Jane <jane@example.com>");
  assert.equal(m.subject, "Invoice");
  assert.equal(m.text, "Please pay by Oct 15.");
  assert.equal(m.attachments[0].filename, "invoice.pdf");
  assert.equal(m.ts, "2026-09-28T12:53:20.000Z");
});

test("unsubscribe helpers: List-Unsubscribe, mailto, grouping and keep list", async () => {
  const u = await import("../src/lib/unsubscribe.js");
  const t = u.parseListUnsubscribe("<mailto:out@list.shop.com?subject=stop>, <https://shop.com/u?id=1>", "List-Unsubscribe=One-Click");
  assert.deepEqual(t, { https: ["https://shop.com/u?id=1"], mailto: ["mailto:out@list.shop.com?subject=stop"], oneClick: true });
  assert.equal(u.parseListUnsubscribe("<http://insecure.example/u>").https.length, 0);
  assert.deepEqual(u.parseMailto("mailto:out@x.com?subject=stop"), { to: "out@x.com", subject: "stop", body: "unsubscribe" });
  assert.deepEqual(u.parseFrom('"Shop News" <News@Shop.com>'), { name: "Shop News", address: "news@shop.com" });
  const h = u.parseHeaderBlock("List-Unsubscribe: <https://a.com/u>,\r\n <mailto:u@a.com>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n");
  assert.equal(h["list-unsubscribe"], "<https://a.com/u>, <mailto:u@a.com>");
  const base = { subject: "s", listUnsubscribePost: "" };
  const groups = u.groupBulkSenders(
    [
      { ...base, uid: 1, from: "<a@shop.com>", date: "2026-01-01", listUnsubscribe: "<https://shop.com/u>" },
      { ...base, uid: 2, from: "<a@shop.com>", date: "2026-02-01", listUnsubscribe: "<https://shop.com/u2>" },
      { ...base, uid: 3, from: "<friend@gmail.com>", date: "2026-02-01", listUnsubscribe: "" },
      { ...base, uid: 4, from: "<alerts@mail.bank.ca>", date: "2026-02-01", listUnsubscribe: "<https://bank.ca/u>" },
    ],
    ["bank.ca"],
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].uids, [1, 2]);
  assert.deepEqual(groups[0].targets.https, ["https://shop.com/u2"]);
});
