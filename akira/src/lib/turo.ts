/** Turok: Amos's Turo agent. State, pricing engine, lifecycle and outbox. Pure functions are unit-tested. */
import path from "node:path";
import { AKIRA_ROOT, BRAIN, PATHS } from "../config.js";
import { identity, journal, newId, nowIso, readJson, readText, writeJson } from "./brain.js";
import type { TuroAction, TuroDemandEvent, TuroPriceDay, TuroState, TuroTrip, TuroVehicle } from "./types.js";

export const TURO_STATE = path.join(PATHS.state, "turo.json");
export const TURO_CONFIG = path.join(BRAIN, "turo", "config.json");
export const TUROK_SOUL = path.join(AKIRA_ROOT, "TUROK.md");

export interface TuroConfig {
  hostName: string;
  currency: string;
  links: { turo: string };
  pricing: {
    horizonDays: number;
    dayOfWeekMultipliers: number[];
    monthMultipliers: number[];
    lastMinuteDays: number;
    lastMinuteMultiplier: number;
    highUtilisation: number;
    highUtilisationMultiplier: number;
    lowUtilisation: number;
    lowUtilisationMultiplier: number;
    minChangeDollars: number;
    minChangePercent: number;
  };
  booking: { autoAcceptUnlessConflict: boolean; minTripDays: number; bufferHoursBetweenTrips: number };
  lifecycle: {
    preTripHoursBefore: number;
    checkoutReminderHoursBefore: number;
    thankYouHoursAfter: number;
    prepReminderHoursBefore: number;
    damageClaimWindowHours: number;
    reimbursementWindowDays: number;
  };
  houseRules: string[];
  templates: Record<"booked" | "preTrip" | "checkoutReminder" | "thankYou", string>;
}

export function turoConfig(): TuroConfig {
  return readJson<TuroConfig>(TURO_CONFIG, {} as TuroConfig);
}

export function turokSoul(): string {
  return readText(TUROK_SOUL);
}

export function emptyTuro(): TuroState {
  return { vehicles: [], trips: [], messages: [], outbox: [], prices: {}, applied: {}, demandEvents: [], updatedAt: "" };
}

export function loadTuro(): TuroState {
  return { ...emptyTuro(), ...readJson<Partial<TuroState>>(TURO_STATE, {}) };
}

export function saveTuro(s: TuroState): void {
  s.updatedAt = nowIso();
  writeJson(TURO_STATE, s);
}

/** True for mail sent by Turo (bookings, guest messages, payouts, claims). */
export function isTuroEmail(from: string | undefined): boolean {
  return !!from && /@([a-z0-9-]+\.)*turo\.com\b/i.test(from);
}

// ---------- dates ----------

const DAY = 86400_000;

/** YYYY-MM-DD of an instant in a timezone. */
export function localDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Calendar dates a trip occupies (start date up to, not including, the end date unless same-day). */
export function tripDates(trip: Pick<TuroTrip, "start" | "end">, tz: string): string[] {
  const a = localDate(Date.parse(trip.start), tz);
  const b = localDate(Date.parse(trip.end), tz);
  const out: string[] = [];
  for (let d = a; d < b || d === a; d = addDays(d, 1)) out.push(d);
  return out;
}

const ACTIVE: TuroTrip["status"][] = ["booked", "in_progress"];

export function bookedDates(trips: TuroTrip[], vehicleId: string, tz: string): Set<string> {
  const s = new Set<string>();
  for (const t of trips) if (t.vehicleId === vehicleId && ACTIVE.includes(t.status)) tripDates(t, tz).forEach((d) => s.add(d));
  return s;
}

// ---------- pricing ----------

export function priceCalendar(opts: {
  vehicle: TuroVehicle;
  today: string;
  booked: Set<string>;
  demand: TuroDemandEvent[];
  rules: TuroConfig["pricing"];
}): TuroPriceDay[] {
  const { vehicle: v, today, booked, demand, rules: r } = opts;
  if (!v.basePrice) return [];
  const floor = v.minPrice ?? Math.round(v.basePrice * 0.7);
  const ceil = v.maxPrice ?? Math.round(v.basePrice * 2);
  let next30 = 0;
  for (let i = 0; i < 30; i++) if (booked.has(addDays(today, i))) next30++;
  const util = next30 / 30;
  const out: TuroPriceDay[] = [];
  for (let i = 0; i < r.horizonDays; i++) {
    const date = addDays(today, i);
    const d = new Date(`${date}T12:00:00Z`);
    const reasons: string[] = [`base ${v.basePrice}`];
    let p = v.basePrice;
    const dow = r.dayOfWeekMultipliers[d.getUTCDay()] ?? 1;
    if (dow !== 1) reasons.push(`${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ×${dow}`);
    p *= dow;
    const mon = r.monthMultipliers[d.getUTCMonth()] ?? 1;
    if (mon !== 1) reasons.push(`season ×${mon}`);
    p *= mon;
    const ev = demand.filter((e) => e.start <= date && date <= e.end).sort((a, b) => b.multiplier - a.multiplier)[0];
    if (ev) {
      p *= ev.multiplier;
      reasons.push(`${ev.name} ×${ev.multiplier}`);
    }
    const isBooked = booked.has(date);
    if (!isBooked && i < r.lastMinuteDays) {
      p *= r.lastMinuteMultiplier;
      reasons.push(`last-minute ×${r.lastMinuteMultiplier}`);
    }
    if (util >= r.highUtilisation) {
      p *= r.highUtilisationMultiplier;
      reasons.push(`busy ${Math.round(util * 100)}% ×${r.highUtilisationMultiplier}`);
    } else if (util <= r.lowUtilisation) {
      p *= r.lowUtilisationMultiplier;
      reasons.push(`quiet ${Math.round(util * 100)}% ×${r.lowUtilisationMultiplier}`);
    }
    let price = Math.round(p);
    if (price < floor) (price = floor), reasons.push(`floor ${floor}`);
    if (price > ceil) (price = ceil), reasons.push(`ceiling ${ceil}`);
    out.push({ date, price, booked: isBooked, reasons });
  }
  return out;
}

/** Unbooked dates whose recommended price moved enough from what is set in Turo. */
export function priceChanges(days: TuroPriceDay[], applied: Record<string, number>, r: TuroConfig["pricing"]): TuroPriceDay[] {
  return days.filter((d) => {
    if (d.booked) return false;
    const cur = applied[d.date];
    if (cur === undefined) return true;
    const diff = Math.abs(d.price - cur);
    return diff >= r.minChangeDollars && diff >= cur * r.minChangePercent;
  });
}

/** "Oct 3–5: $84" lines, consecutive dates with the same price grouped. */
export function priceLines(days: TuroPriceDay[], currency: string): string[] {
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
  const lines: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1].price === days[i].price && days[j + 1].date === addDays(days[j].date, 1)) j++;
    lines.push(`${fmt(days[i].date)}${j > i ? ` – ${fmt(days[j].date)}` : ""}: $${days[i].price} ${currency}`);
    i = j + 1;
  }
  return lines;
}

// ---------- messages ----------

export function fmtWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function firstName(guest: string): string {
  return guest.trim().split(/\s+/)[0] || guest;
}

/** Fill a template. Returns the text and the placeholders that had no value. */
export function renderTemplate(tpl: string, vars: Record<string, string | undefined>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = tpl
    .replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vars[k];
      if (v === undefined || v === "") {
        missing.push(k);
        return "";
      }
      return v;
    })
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { text, missing };
}

// ---------- lifecycle ----------

export type LifecycleStep = "booked" | "preTrip" | "checkoutReminder" | "thankYou" | "start" | "end" | "prepReminder" | "claimReminder" | "reimburseReminder" | "calendar";

/** Which lifecycle steps are due now for a trip and have not been done yet. Pure. */
export function dueSteps(trip: TuroTrip, nowMs: number, c: TuroConfig["lifecycle"]): LifecycleStep[] {
  if (!ACTIVE.includes(trip.status) && trip.status !== "completed") return [];
  const s = Date.parse(trip.start);
  const e = Date.parse(trip.end);
  const H = 3600_000;
  if (nowMs > e + 14 * DAY) return []; // old trips found in history: record only, no messages or reminders
  const done = (k: LifecycleStep) => !!trip.lifecycle[k];
  const out: LifecycleStep[] = [];
  const add = (k: LifecycleStep, cond: boolean) => cond && !done(k) && out.push(k);
  add("calendar", true);
  add("booked", nowMs < s - c.preTripHoursBefore * H);
  add("prepReminder", nowMs < s);
  add("preTrip", nowMs >= s - c.preTripHoursBefore * H && nowMs < s);
  add("start", nowMs >= s && trip.status === "booked");
  add("checkoutReminder", nowMs >= e - c.checkoutReminderHoursBefore * H && nowMs < e);
  add("end", nowMs >= e && trip.status !== "completed");
  add("thankYou", nowMs >= e + c.thankYouHoursAfter * H && nowMs < e + 72 * H);
  add("claimReminder", nowMs >= e - c.checkoutReminderHoursBefore * H && nowMs < e + c.damageClaimWindowHours * H);
  add("reimburseReminder", nowMs >= e);
  return out;
}

// ---------- outbox ----------

export function queueAction(s: TuroState, a: Omit<TuroAction, "id" | "createdAt" | "status">): TuroAction {
  const action: TuroAction = { id: newId("turo"), createdAt: nowIso(), status: "queued", ...a };
  s.outbox.unshift(action);
  s.outbox = s.outbox.slice(0, 500);
  journal({
    kind: "draft",
    source: a.source,
    summary: `Turok queued ${a.kind}: ${a.title}${a.needs ? ` (needs: ${a.needs})` : ""} — ${a.why}`,
    tags: ["turok", "turo", a.kind],
    refs: [action.id, ...(a.tripId ? [a.tripId] : [])],
    data: { body: a.body, guest: a.guest, vehicleId: a.vehicleId, link: a.link },
  });
  return action;
}

/** Mark an outbox action done/skipped. Applying a set_price records the prices as live in Turo. */
export function markAction(s: TuroState, id: string, status: "done" | "skipped", source: string): TuroAction | undefined {
  const a = s.outbox.find((x) => x.id === id);
  if (!a) return undefined;
  a.status = status;
  a.doneAt = nowIso();
  if (status === "done" && a.kind === "set_price" && a.vehicleId) {
    const applied = (s.applied[a.vehicleId] ??= {});
    for (const d of (a.data as { days?: TuroPriceDay[] } | undefined)?.days ?? []) applied[d.date] = d.price;
  }
  if (status === "done" && a.kind === "message" && a.guest) {
    s.messages.push({ id: newId("tmsg"), ts: a.doneAt, tripId: a.tripId, guest: a.guest, direction: "out", text: a.body, source: a.id });
  }
  journal({ kind: "event", source, summary: `Turo action ${status}: ${a.title}`, tags: ["turok", "turo", a.kind, status], refs: [a.id] });
  return a;
}

export function tripLink(s: TuroState, trip?: TuroTrip): string {
  return trip?.reservationUrl ?? s.vehicles.find((v) => v.id === trip?.vehicleId)?.listingUrl ?? turoConfig().links?.turo ?? "https://turo.com";
}

export function vehicleName(s: TuroState, id?: string): string {
  return s.vehicles.find((v) => v.id === id)?.name ?? "car";
}

export function ownerTz(): string {
  return identity().owner?.timezone ?? "America/Toronto";
}
