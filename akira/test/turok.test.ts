import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the brain at a temp copy so tests never touch the real memory.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "turok-"));
fs.cpSync(path.resolve(import.meta.dirname, "../brain"), path.join(tmp, "brain"), { recursive: true });
fs.copyFileSync(path.resolve(import.meta.dirname, "../SOUL.md"), path.join(tmp, "SOUL.md"));
fs.copyFileSync(path.resolve(import.meta.dirname, "../TUROK.md"), path.join(tmp, "TUROK.md"));
fs.rmSync(path.join(tmp, "brain", "state", "turo.json"), { force: true });
process.env.AKIRA_ROOT = tmp;
process.env.AKIRA_DRY_RUN = "1";

const turo = await import("../src/lib/turo.js");
const { turokTick, applyTuroResults, repriceFleet } = await import("../src/cycles/turok.js");
const { buildDashboard } = await import("../src/lib/dashboard.js");
const brain = await import("../src/lib/brain.js");

const rules = turo.turoConfig().pricing;
const car = { id: "m3", name: "Tesla Model 3", basePrice: 100, minPrice: 70, maxPrice: 180, active: true, source: "test", updatedAt: "" };

test("isTuroEmail matches Turo senders only", () => {
  assert.ok(turo.isTuroEmail("Turo <noreply@turo.com>"));
  assert.ok(turo.isTuroEmail("messages@mail.turo.com"));
  assert.ok(!turo.isTuroEmail("someone@notturo.co"));
  assert.ok(!turo.isTuroEmail(undefined));
});

test("priceCalendar applies weekday, season, demand, clamps", () => {
  // 2026-07-18 is a Saturday in July: 100 × 1.18 × 1.22 = 144, then busy/quiet adjustments.
  const days = turo.priceCalendar({ vehicle: car, today: "2026-07-14", booked: new Set(), demand: [], rules });
  assert.equal(days.length, rules.horizonDays);
  const sat = days.find((d) => d.date === "2026-07-18")!;
  assert.equal(sat.price, Math.round(100 * 1.18 * 1.22 * rules.lowUtilisationMultiplier));
  const withEvent = turo.priceCalendar({ vehicle: car, today: "2026-07-14", booked: new Set(), demand: [{ id: "e", name: "Big Show", start: "2026-07-18", end: "2026-07-18", multiplier: 1.5, source: "t" }], rules });
  assert.equal(withEvent.find((d) => d.date === "2026-07-18")!.price, 180, "clamped to ceiling");
  assert.ok(withEvent.find((d) => d.date === "2026-07-18")!.reasons.some((r) => r.startsWith("ceiling")));
  assert.deepEqual(turo.priceCalendar({ vehicle: { ...car, basePrice: undefined }, today: "2026-07-14", booked: new Set(), demand: [], rules }), []);
});

test("priceChanges ignores booked and small moves; priceLines groups runs", () => {
  const days = [
    { date: "2026-10-02", price: 90, booked: false, reasons: [] },
    { date: "2026-10-03", price: 90, booked: false, reasons: [] },
    { date: "2026-10-04", price: 120, booked: true, reasons: [] },
    { date: "2026-10-05", price: 101, booked: false, reasons: [] },
  ];
  const ch = turo.priceChanges(days, { "2026-10-05": 100 }, rules);
  assert.deepEqual(ch.map((d) => d.date), ["2026-10-02", "2026-10-03"]);
  assert.equal(turo.priceLines(ch, "CAD").length, 1);
});

test("renderTemplate reports missing facts instead of inventing them", () => {
  const r = turo.renderTemplate("Hi {guest}\nPickup: {pickup}\n{checkin}", { guest: "Sam" });
  assert.deepEqual(r.missing, ["pickup", "checkin"]);
  assert.equal(r.text, "Hi Sam\nPickup:");
});

test("dueSteps fires each step once in its window and ignores old history", () => {
  const c = turo.turoConfig().lifecycle;
  const start = Date.parse("2026-10-10T14:00:00Z");
  const trip = { id: "t1", guest: "Sam Lee", start: new Date(start).toISOString(), end: new Date(start + 2 * 86400_000).toISOString(), status: "booked" as const, source: "t", createdAt: "", updatedAt: "", lifecycle: {} as Record<string, string> };
  const early = turo.dueSteps(trip, start - 5 * 86400_000, c);
  assert.deepEqual(early, ["calendar", "booked", "prepReminder"]);
  for (const k of early) trip.lifecycle[k] = "x";
  assert.deepEqual(turo.dueSteps(trip, start - 5 * 86400_000, c), []);
  assert.deepEqual(turo.dueSteps(trip, start - 3600_000, c), ["preTrip"]);
  assert.deepEqual(turo.dueSteps({ ...trip, lifecycle: {} }, start + 60 * 86400_000, c), []);
});

test("turokTick sends lifecycle messages, reminders, calendar and prices into the outbox", async () => {
  const s = turo.loadTuro();
  const start = new Date(Date.now() + 10 * 3600_000).toISOString();
  const end = new Date(Date.now() + 58 * 3600_000).toISOString();
  s.vehicles.push({ ...car, pickup: "123 King St W", checkin: "Lockbox code is in the Turo app." });
  s.trips.push({ id: "R1", vehicleId: "m3", guest: "Sam Lee", start, end, status: "booked", source: "test", createdAt: "", updatedAt: "", lifecycle: {} });
  turo.saveTuro(s);
  await turokTick();
  const after = turo.loadTuro();
  const msg = after.outbox.find((a) => a.kind === "message")!;
  assert.match(msg.title, /Pre-trip/);
  assert.match(msg.body, /123 King St W/);
  assert.equal(msg.needs, undefined);
  const price = after.outbox.find((a) => a.kind === "set_price")!;
  assert.ok(price && price.body.includes("$"));
  assert.ok(brain.state.calendar().events.some((e) => e.title.startsWith("Turo: Sam")));
  assert.ok(brain.state.reminders().items.some((r) => r.text.includes("Clean")));

  // Running again does not duplicate anything.
  const n = after.outbox.length;
  await turokTick();
  assert.equal(turo.loadTuro().outbox.length, n);

  // Amos marks the prices as applied: they become the live prices, and no new action is needed.
  const rest = applyTuroResults([{ id: "e1", ts: brain.nowIso(), source: "turo", type: "action-result", payload: { actionId: price.id, status: "done" } }]);
  assert.equal(rest.length, 0);
  const marked = turo.loadTuro();
  assert.equal(marked.outbox.find((a) => a.id === price.id)!.status, "done");
  assert.ok(Object.keys(marked.applied.m3).length > 0);
  assert.equal(repriceFleet(marked, "test"), 0);

  const d = buildDashboard();
  assert.ok(d.turo && d.turo.vehicles.length === 1 && d.turo.outbox.length >= 1);
  assert.ok(brain.journalRecent(50).some((j) => j.tags?.includes("turok")));
});
