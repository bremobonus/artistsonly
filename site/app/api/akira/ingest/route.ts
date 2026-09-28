import { NextResponse } from "next/server";
import { hasIngestAccess } from "@/lib/auth";
import { landEvent, normaliseEvent } from "@/lib/store";
import type { IngestEvent, IngestSource } from "@/lib/akira-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/akira/ingest[?source=apple_health&device=iphone]
 * Body: one event, an array of events, or any JSON (wrapped as the payload).
 * Auth: Authorization: Bearer <AKIRA_INGEST_SECRET> or X-Akira-Secret header.
 */
export async function POST(req: Request) {
  if (!hasIngestAccess(req)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  const url = new URL(req.url);
  const defaults = {
    source: (url.searchParams.get("source") ?? undefined) as IngestSource | undefined,
    device: url.searchParams.get("device") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
  };
  let body: unknown;
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) body = await req.json();
    else {
      const text = await req.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = { source: defaults.source ?? "note", payload: { text } };
      }
    }
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }
  const raw = Array.isArray(body) ? body : [body];
  if (raw.length > 200) return NextResponse.json({ ok: false, error: "max 200 events per call" }, { status: 413 });

  const events: IngestEvent[] = [];
  for (const item of raw) {
    const ev = normaliseEvent(item, defaults) ?? normaliseEvent({ source: defaults.source, payload: item }, defaults);
    if (ev) events.push(ev);
  }
  if (!events.length) return NextResponse.json({ ok: false, error: "no valid events (source required)" }, { status: 400 });

  const results = [];
  for (const ev of events) results.push(await landEvent(ev));
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json(
    { ok: failed.length === 0, landed: results.length - failed.length, failed: failed.map((f) => ({ status: f.status, detail: f.detail })), ids: events.map((e) => e.id) },
    { status: failed.length ? 502 : 200 },
  );
}

export async function GET() {
  return NextResponse.json({ ok: true, akira: "listening", how: "POST JSON with Authorization: Bearer <secret>" });
}
