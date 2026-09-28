import { activity, identity, newId, nowIso, state } from "../lib/brain.js";
import type { CalendarEvent } from "../lib/types.js";

/** Minimal ICS parser: VEVENT with SUMMARY/DTSTART/DTEND/LOCATION/DESCRIPTION/UID. */
export function parseIcs(ics: string, source: string): CalendarEvent[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const out: CalendarEvent[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const get = (k: string) => {
      const m = body.match(new RegExp(`^${k}[^:\\n]*:(.*)$`, "m"));
      return m ? m[1].trim() : undefined;
    };
    const dt = (v?: string) => {
      if (!v) return undefined;
      if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
      const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
      return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ""}` : v;
    };
    const start = dt(get("DTSTART"));
    if (!start) continue;
    const allDay = start.length === 10;
    out.push({
      id: `ics_${get("UID") ?? newId("x")}`,
      title: get("SUMMARY") ?? "(untitled)",
      start,
      end: dt(get("DTEND")),
      allDay,
      location: get("LOCATION"),
      notes: get("DESCRIPTION")?.replace(/\\n/g, "\n"),
      source,
      createdAt: nowIso(),
    });
  }
  return out;
}

export async function calendarSync(): Promise<void> {
  const urls = identity().calendars?.subscribedIcsUrls ?? [];
  const cal = state.calendar();
  const akiraOwned = cal.events.filter((e) => !e.id.startsWith("ics_"));
  let imported: CalendarEvent[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      imported = imported.concat(parseIcs(await res.text(), url));
    } catch (e) {
      activity("calendar-sync", "ics-failed", `${url}: ${(e as Error).message}`);
    }
  }
  // Keep only a rolling window of imported events (past 30d .. future 365d); Akira-owned events are kept forever.
  const lo = Date.now() - 30 * 86400_000;
  const hi = Date.now() + 365 * 86400_000;
  imported = imported.filter((e) => {
    const t = Date.parse(e.start);
    return isNaN(t) || (t >= lo && t <= hi);
  });
  const events = [...akiraOwned, ...imported].sort((a, b) => a.start.localeCompare(b.start));
  state.saveCalendar({ events, updatedAt: nowIso() });
  activity("calendar-sync", "synced", `${imported.length} imported from ${urls.length} feed(s), ${akiraOwned.length} Akira-owned`);
}
