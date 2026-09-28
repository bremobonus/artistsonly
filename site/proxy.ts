import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "akira_key";

/**
 * Gate for the hidden operations room. `/akira?k=<AKIRA_DASHBOARD_KEY>` sets a cookie and redirects
 * to the clean URL; any other visitor gets a plain 404 so the page does not appear to exist.
 * Keys are compared here with a constant-time loop (edge runtime, no node:crypto).
 */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(req: NextRequest) {
  const key = process.env.AKIRA_DASHBOARD_KEY;
  if (!key) return process.env.NODE_ENV === "development" ? NextResponse.next() : new NextResponse(null, { status: 404 });
  const q = req.nextUrl.searchParams.get("k");
  if (q && same(q, key)) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("k");
    const res = NextResponse.redirect(url);
    res.cookies.set(COOKIE, key, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return res;
  }
  const c = req.cookies.get(COOKIE)?.value;
  if (c && same(c, key)) return NextResponse.next();
  return new NextResponse(null, { status: 404 });
}

export const config = { matcher: ["/akira/:path*"] };
