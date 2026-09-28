import { timingSafeEqual } from "node:crypto";

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const DASHBOARD_COOKIE = "akira_key";

/** True when the request carries the dashboard key (cookie, header, or ?k=). */
export function hasDashboardAccess(req: Request): boolean {
  const key = process.env.AKIRA_DASHBOARD_KEY;
  if (!key) return process.env.NODE_ENV === "development";
  const url = new URL(req.url);
  if (safeEqual(url.searchParams.get("k"), key)) return true;
  if (safeEqual(req.headers.get("x-akira-key"), key)) return true;
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${DASHBOARD_COOKIE}=([^;]+)`));
  return !!m && safeEqual(decodeURIComponent(m[1]), key);
}

/** True when the request carries the ingest secret (devices, shortcuts, workers). */
export function hasIngestAccess(req: Request): boolean {
  const secret = process.env.AKIRA_INGEST_SECRET;
  if (!secret) return process.env.NODE_ENV === "development";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return safeEqual(bearer, secret) || safeEqual(req.headers.get("x-akira-secret"), secret) || hasDashboardAccess(req);
}
