import { NextResponse } from "next/server";
import { hasDashboardAccess } from "@/lib/auth";
import { readBrainJson } from "@/lib/store";
import type { Dashboard } from "@/lib/akira-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasDashboardAccess(req)) return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  const dash = await readBrainJson<Dashboard | null>("brain/state/dashboard.json", null, 20);
  if (!dash) return NextResponse.json({ ok: false, error: "dashboard not built yet (run `npm run akira dashboard` or wait for the heartbeat)" }, { status: 503 });
  return NextResponse.json({ ok: true, dashboard: dash, servedAt: new Date().toISOString() });
}
