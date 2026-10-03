/**
 * Google (Gmail read-only, Calendar events) via OAuth refresh token. No SDK: plain REST.
 * Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (from `npm run google-auth`).
 * Scopes granted at consent: gmail.readonly, calendar.events.
 */
import type { CalendarEvent } from "../lib/types.js";

/** Full mail scope, needed for IMAP/SMTP over OAuth (XOAUTH2). Used only by the mail-cleanup account. */
export const GOOGLE_MAIL_SCOPES = ["https://mail.google.com/"];

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.events"];

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

const cache = new Map<string, { token: string; exp: number }>();

export interface GoogleCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Access token for the given credentials (defaults to Amos's GOOGLE_* secrets). Cached per refresh token. */
export async function accessToken(creds?: GoogleCreds): Promise<string> {
  const c = creds ?? { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, refreshToken: process.env.GOOGLE_REFRESH_TOKEN! };
  const hit = cache.get(c.refreshToken);
  if (hit && hit.exp > Date.now() + 30_000) return hit.token;
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: c.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(c.refreshToken, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

async function g<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Google API ${res.status} ${url.split("?")[0]}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

// ---------- Gmail ----------

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  payload: GmailPart & { headers?: Array<{ name: string; value: string }> };
  snippet?: string;
}

export async function gmailSearch(q: string, maxResults = 50): Promise<string[]> {
  const j = await g<{ messages?: Array<{ id: string }> }>(`${GMAIL}/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`);
  return (j.messages ?? []).map((m) => m.id);
}

export async function gmailMessage(id: string): Promise<GmailMessage> {
  return g<GmailMessage>(`${GMAIL}/messages/${id}?format=full`);
}

export async function gmailAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const j = await g<{ data: string }>(`${GMAIL}/messages/${messageId}/attachments/${attachmentId}`);
  return b64urlToBuffer(j.data);
}

export function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface ParsedMail {
  id: string;
  threadId: string;
  ts: string;
  from: string;
  to: string;
  subject: string;
  messageId: string;
  text: string;
  html?: string;
  attachments: Array<{ filename: string; mimeType: string; attachmentId?: string; size: number }>;
}

/** Pure: turn a Gmail full-format message into our shape. */
export function parseGmailMessage(m: GmailMessage): ParsedMail {
  const h = (name: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  let text = "";
  let html: string | undefined;
  const attachments: ParsedMail["attachments"] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      attachments.push({ filename: p.filename, mimeType: p.mimeType ?? "application/octet-stream", attachmentId: p.body.attachmentId, size: p.body.size ?? 0 });
    } else if (p.mimeType === "text/plain" && p.body?.data && !text) {
      text = b64urlToBuffer(p.body.data).toString("utf8");
    } else if (p.mimeType === "text/html" && p.body?.data && !html) {
      html = b64urlToBuffer(p.body.data).toString("utf8");
    }
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  if (!text && html) text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const ts = new Date(Number(m.internalDate) || Date.now()).toISOString();
  return { id: m.id, threadId: m.threadId, ts, from: h("From"), to: h("To"), subject: h("Subject"), messageId: h("Message-ID"), text, html, attachments };
}

// ---------- Calendar ----------

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
}

export async function calendarEvents(timeMinIso: string, timeMaxIso: string): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  let pageToken = "";
  do {
    const url = `${CAL}?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(timeMinIso)}&timeMax=${encodeURIComponent(timeMaxIso)}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const j = await g<{ items?: GEvent[]; nextPageToken?: string }>(url);
    for (const e of j.items ?? []) {
      if (e.status === "cancelled") continue;
      const start = e.start?.dateTime ?? e.start?.date;
      if (!start) continue;
      out.push({
        id: `gcal_${e.id}`,
        title: e.summary ?? "(untitled)",
        start,
        end: e.end?.dateTime ?? e.end?.date,
        allDay: !e.start?.dateTime,
        location: e.location,
        notes: e.description,
        source: "google:primary",
        createdAt: new Date().toISOString(),
        googleId: e.id,
      });
    }
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

export async function calendarInsert(ev: { title: string; start: string; end?: string; allDay?: boolean; location?: string; notes?: string; timezone: string }): Promise<string> {
  const body: Record<string, unknown> = { summary: ev.title, location: ev.location, description: ev.notes };
  if (ev.allDay || ev.start.length === 10) {
    const endDate = ev.end?.slice(0, 10) ?? new Date(Date.parse(ev.start.slice(0, 10)) + 86400_000).toISOString().slice(0, 10);
    body.start = { date: ev.start.slice(0, 10) };
    body.end = { date: endDate };
  } else {
    const endIso = ev.end ?? new Date(Date.parse(ev.start) + 3600_000).toISOString();
    body.start = { dateTime: ev.start, timeZone: ev.timezone };
    body.end = { dateTime: endIso, timeZone: ev.timezone };
  }
  const j = await g<{ id: string }>(CAL, { method: "POST", body: JSON.stringify(body) });
  return j.id;
}
