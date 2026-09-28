import { hasDashboardAccess } from "@/lib/auth";
import { readBrainJson } from "@/lib/store";
import type { CalendarEvent } from "@/lib/akira-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const icsDate = (iso: string) => (iso.length === 10 ? iso.replace(/-/g, "") : new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""));

/** GET /api/akira/calendar?k=<dashboard key> — subscribe to this URL in Apple/Google Calendar. */
export async function GET(req: Request) {
  if (!hasDashboardAccess(req)) return new Response("unauthorised", { status: 401 });
  const cal = await readBrainJson<{ events: CalendarEvent[] }>("brain/state/calendar.json", { events: [] }, 60);
  const own = cal.events.filter((e) => !e.id.startsWith("ics_"));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//artistsonly.io//Akira//EN", "X-WR-CALNAME:Akira", "CALSCALE:GREGORIAN"];
  for (const e of own) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@artistsonly.io`, `DTSTAMP:${icsDate(e.createdAt)}`);
    if (e.allDay || e.start.length === 10) lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start.slice(0, 10))}`);
    else lines.push(`DTSTART:${icsDate(e.start)}`);
    if (e.end) lines.push(e.allDay || e.end.length === 10 ? `DTEND;VALUE=DATE:${icsDate(e.end.slice(0, 10))}` : `DTEND:${icsDate(e.end)}`);
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" } });
}
