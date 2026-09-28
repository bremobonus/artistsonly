import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.js";
import { activity, archiveRaw, identity, journal, listInbox, nowIso, state, storeDocument } from "../lib/brain.js";
import { runAgent } from "../lib/claude.js";
import { akiraTools } from "../tools.js";
import type { HealthDaily, IngestEvent } from "../lib/types.js";

/** Deterministic handlers for high-volume telemetry; everything else goes to the model. */
function handleDevice(ev: IngestEvent): void {
  const d = state.devices();
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  const id = ev.device ?? String(p.id ?? "unknown");
  const known = identity().devices?.expected?.find((x) => x.id === id);
  d.devices[id] = {
    id,
    label: String(p.label ?? known?.label ?? d.devices[id]?.label ?? id),
    kind: String(p.kind ?? known?.kind ?? d.devices[id]?.kind ?? "device"),
    lastSeen: ev.ts,
    battery: typeof p.battery === "number" ? p.battery : d.devices[id]?.battery,
    summary: typeof p.summary === "string" ? p.summary : d.devices[id]?.summary,
    extra: { ...(d.devices[id]?.extra ?? {}), ...(typeof p.extra === "object" && p.extra ? (p.extra as Record<string, unknown>) : {}) },
  };
  d.updatedAt = nowIso();
  state.saveDevices(d);
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && !isNaN(n) ? n : undefined;
}

/** Accepts either our flat HealthDaily-ish payload or Health Auto Export's {data:{metrics:[...]}} shape. */
function handleHealth(ev: IngestEvent): string {
  const h = state.health();
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  const touched = new Map<string, Partial<HealthDaily>>();
  const upsert = (date: string, patch: Partial<HealthDaily>) => touched.set(date, { ...(touched.get(date) ?? {}), ...patch });

  const metrics = (p.data as { metrics?: Array<{ name: string; units?: string; data: Array<Record<string, unknown>> }> } | undefined)?.metrics;
  if (Array.isArray(metrics)) {
    const map: Record<string, keyof HealthDaily> = {
      step_count: "steps",
      resting_heart_rate: "restingHeartRate",
      heart_rate: "heartRateAvg",
      heart_rate_variability: "hrv",
      sleep_analysis: "sleepHours",
      active_energy: "activeEnergyKcal",
      apple_exercise_time: "exerciseMinutes",
      apple_stand_hour: "standHours",
      blood_oxygen_saturation: "bloodOxygen",
      respiratory_rate: "respiratoryRate",
      weight_body_mass: "weightKg",
    };
    for (const m of metrics) {
      const key = map[m.name];
      if (!key) continue;
      for (const row of m.data ?? []) {
        const date = String(row.date ?? ev.ts).slice(0, 10);
        let v = num(row.qty ?? row.Avg ?? row.avg ?? row.value);
        if (m.name === "sleep_analysis") v = num(row.asleep ?? row.totalSleep ?? row.qty);
        if (m.name === "heart_rate") v = num(row.Avg ?? row.avg ?? row.qty);
        if (v === undefined) continue;
        const prev = touched.get(date)?.[key] as number | undefined;
        // steps / energy / exercise accumulate across samples in a day; the rest are levels.
        const accumulate = key === "steps" || key === "activeEnergyKcal" || key === "exerciseMinutes";
        upsert(date, { [key]: accumulate ? (prev ?? 0) + v : v } as Partial<HealthDaily>);
      }
    }
  } else {
    const date = String(p.date ?? ev.ts).slice(0, 10);
    const patch: Partial<HealthDaily> = {};
    for (const k of ["steps", "restingHeartRate", "heartRateAvg", "hrv", "sleepHours", "activeEnergyKcal", "exerciseMinutes", "standHours", "bloodOxygen", "respiratoryRate", "weightKg"] as const) {
      const v = num(p[k]);
      if (v !== undefined) (patch as Record<string, number>)[k] = v;
    }
    if (Array.isArray(p.workouts)) patch.workouts = p.workouts as HealthDaily["workouts"];
    upsert(date, patch);
  }

  for (const [date, patch] of touched) {
    const i = h.daily.findIndex((d) => d.date === date);
    if (i === -1) h.daily.push({ date, ...patch });
    else h.daily[i] = { ...h.daily[i], ...patch };
  }
  h.daily.sort((a, b) => a.date.localeCompare(b.date));
  h.daily = h.daily.slice(-400);
  const latest = h.daily[h.daily.length - 1];
  if (latest) h.latest = { ...latest, asOf: ev.ts };
  h.updatedAt = nowIso();
  state.saveHealth(h);
  return [...touched.keys()].join(",");
}

function handleDocument(ev: IngestEvent): string {
  const p = (ev.payload ?? {}) as { name?: string; base64?: string; path?: string; note?: string };
  let bytes: Buffer | undefined;
  if (p.base64) bytes = Buffer.from(p.base64, "base64");
  else if (p.path) {
    const abs = path.isAbsolute(p.path) ? p.path : path.join(PATHS.documents, "..", p.path);
    if (fs.existsSync(abs)) bytes = fs.readFileSync(abs);
  }
  if (!bytes) return "no bytes";
  const m = storeDocument({ bytes, originalName: p.name ?? "document", source: `${ev.source}:${ev.device ?? "?"}:${ev.id}`, receivedAt: ev.ts, notes: p.note });
  journal({ kind: "document", source: ev.id, summary: `Document archived: ${m.originalName} (${m.bytes} bytes, sha256 ${m.sha256.slice(0, 12)}…)`, refs: [m.id], tags: ["document"] });
  return m.id;
}

export async function processInbox(): Promise<void> {
  const items = listInbox();
  if (!items.length) {
    activity("process-inbox", "idle", "inbox empty");
    return;
  }
  const forModel: IngestEvent[] = [];
  let telemetry = 0;
  for (const { file, event } of items) {
    try {
      if (event.source === "device") {
        handleDevice(event);
        telemetry++;
      } else if (event.source === "apple_health") {
        const dates = handleHealth(event);
        journal({ kind: "health", source: event.id, summary: `Health data received from ${event.device ?? "phone"} for ${dates || "unknown date"}`, tags: ["health", "telemetry"], ts: event.ts });
        telemetry++;
      } else if (event.source === "location") {
        handleDevice({ ...event, source: "device", payload: { summary: `location: ${JSON.stringify(event.payload)}` } });
        telemetry++;
      } else if (event.source === "document") {
        handleDocument(event);
        forModel.push(event);
      } else {
        forModel.push(event);
      }
      // Raw event is always journaled and archived, whatever its kind.
      journal({ kind: "event", source: `${event.source}:${event.device ?? "-"}`, summary: `Raw event ${event.id} (${event.type ?? "-"}) received`, ts: event.ts, refs: [event.id], data: event.source === "device" || event.source === "apple_health" ? undefined : event.payload });
      archiveRaw(file, event);
    } catch (e) {
      activity("process-inbox", "error", `${path.basename(file)}: ${(e as Error).message}`);
    }
  }
  activity("process-inbox", "telemetry", `${telemetry} device/health events applied`);

  if (!forModel.length) return;
  if (!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
    // Raw events are already journaled and archived above; digestion waits for the key.
    activity("process-inbox", "skipped", `${forModel.length} event(s) archived but not digested: ANTHROPIC_API_KEY is not set`);
    return;
  }

  const batches: IngestEvent[][] = [];
  let cur: IngestEvent[] = [];
  let size = 0;
  for (const ev of forModel) {
    const s = JSON.stringify(ev).length;
    if (cur.length && size + s > 150_000) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(ev);
    size += s;
  }
  if (cur.length) batches.push(cur);

  const t = akiraTools("process-inbox");
  for (const batch of batches) {
    const { text } = await runAgent({
      cycle: "process-inbox",
      instructions: [
        "You are reading new events from Amos's devices, email and other AI agents.",
        "For each event: extract every date, deadline, commitment (made or owed), person, decision, money amount, and fact worth keeping.",
        "Use the tools: remember, note_person, set_reminder, add_calendar_event, send_email (when a reply or outreach is clearly needed and you have the facts), draft_email (when you lack a fact only Amos knows), log_decision (whenever you make a call on Amos's behalf). Never ask Amos; decide and log.",
        "Be exhaustive. Nothing in these events may be lost. Prefer several small tool calls over one vague one.",
        "Finish with a 2-5 line plain summary of what you learned.",
      ].join("\n"),
      userContent: "## New events\n```json\n" + JSON.stringify(batch, null, 1) + "\n```",
      tools: [t.remember, t.notePerson, t.setReminder, t.addCalendarEvent, t.sendEmail, t.draftEmail, t.logDecision],
      maxIterations: 40,
    });
    journal({ kind: "system", source: "process-inbox", summary: `Digested ${batch.length} event(s): ${text.slice(0, 800)}`, refs: batch.map((e) => e.id), tags: ["digest"] });
    activity("process-inbox", "digested", `${batch.length} event(s)`);
  }
}
