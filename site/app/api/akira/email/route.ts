import { NextResponse } from "next/server";
import PostalMime from "postal-mime";
import { hasIngestAccess } from "@/lib/auth";
import { landEvent, normaliseEvent } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTACHMENT = 4 * 1024 * 1024; // GitHub contents API limit is ~100MB but keep events small

/**
 * Inbound mail for akira@artistsonly.io.
 * Accepts: { raw: "<full MIME>" } (Cloudflare Email Worker), or a pre-parsed { from, to, subject, text, html, attachments:[{name, contentType, base64}] }.
 */
export async function POST(req: Request) {
  if (!hasIngestAccess(req)) return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    const ct = req.headers.get("content-type") ?? "";
    body = ct.includes("application/json") ? await req.json() : { raw: await req.text() };
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }

  let mail: { from?: string; to?: string; subject?: string; date?: string; text?: string; html?: string; messageId?: string; attachments: Array<{ name: string; contentType: string; base64: string; bytes: number }> };
  if (typeof body.raw === "string") {
    const parsed = await PostalMime.parse(body.raw);
    mail = {
      from: parsed.from ? `${parsed.from.name ?? ""} <${parsed.from.address ?? ""}>`.trim() : undefined,
      to: parsed.to?.map((t) => t.address).filter(Boolean).join(", "),
      subject: parsed.subject,
      date: parsed.date,
      text: parsed.text,
      html: parsed.html,
      messageId: parsed.messageId,
      attachments: (parsed.attachments ?? [])
        .filter((a) => a.content && (a.content as ArrayBuffer).byteLength <= MAX_ATTACHMENT)
        .map((a) => ({ name: a.filename ?? "attachment", contentType: a.mimeType, base64: Buffer.from(a.content as ArrayBuffer).toString("base64"), bytes: (a.content as ArrayBuffer).byteLength })),
    };
  } else {
    mail = {
      from: String(body.from ?? ""),
      to: String(body.to ?? ""),
      subject: String(body.subject ?? ""),
      date: typeof body.date === "string" ? body.date : undefined,
      text: typeof body.text === "string" ? body.text : undefined,
      html: typeof body.html === "string" ? body.html : undefined,
      messageId: typeof body.messageId === "string" ? body.messageId : undefined,
      attachments: Array.isArray(body.attachments) ? (body.attachments as Array<Record<string, unknown>>).map((a) => ({ name: String(a.name ?? "attachment"), contentType: String(a.contentType ?? "application/octet-stream"), base64: String(a.base64 ?? ""), bytes: Math.floor((String(a.base64 ?? "").length * 3) / 4) })) : [],
    };
  }

  const ts = mail.date && !isNaN(Date.parse(mail.date)) ? new Date(mail.date).toISOString() : new Date().toISOString();
  const emailEvent = normaliseEvent({ source: "email", device: "akira-mailbox", type: "inbound", ts, payload: { from: mail.from, to: mail.to, subject: mail.subject, messageId: mail.messageId, text: mail.text?.slice(0, 200_000), html: mail.html ? mail.html.slice(0, 200_000) : undefined, attachmentNames: mail.attachments.map((a) => a.name) } });
  if (!emailEvent) return NextResponse.json({ ok: false, error: "could not build event" }, { status: 400 });
  const results = [await landEvent(emailEvent)];
  for (const a of mail.attachments) {
    const ev = normaliseEvent({ source: "document", device: "akira-mailbox", type: "email-attachment", ts, payload: { name: a.name, contentType: a.contentType, base64: a.base64, note: `Attachment on email "${mail.subject ?? ""}" from ${mail.from ?? "?"} (event ${emailEvent.id})` } });
    if (ev) results.push(await landEvent(ev));
  }
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({ ok: !failed.length, landed: results.length - failed.length, failed }, { status: failed.length ? 502 : 200 });
}
