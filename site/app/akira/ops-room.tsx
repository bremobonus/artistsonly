"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dashboard, HealthDaily } from "@/lib/akira-types";

const REFRESH_MS = 30_000;

function fmt(iso?: string, tz?: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }): string {
  if (!iso) return "—";
  if (iso.length === 10) return iso;
  try {
    return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function ago(iso?: string): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function Spark({ data, k }: { data: HealthDaily[]; k: keyof HealthDaily }) {
  const vals = data.map((d) => d[k]).filter((v): v is number => typeof v === "number");
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const w = 200;
  const h = 46;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 4 - ((v - min) / (max - min || 1)) * (h - 8)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${String(k)} trend, ${vals.length} days`}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Empty({ text = "nothing" }: { text?: string }) {
  return <div className="empty">{text}</div>;
}

export default function OpsRoom() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [clock, setClock] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/akira/state", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setDash(j.dashboard);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("en-CA", { timeZone: dash?.owner.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [dash?.owner.timezone]);

  async function sendNote() {
    if (!note.trim()) return;
    setSending(true);
    try {
      const r = await fetch("/api/akira/ingest?source=note&device=dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: note.trim() }) });
      if (r.ok) setNote("");
      else setErr(`note failed: HTTP ${r.status}`);
    } finally {
      setSending(false);
    }
  }

  if (err && !dash) return <main className="ops"><div className="err">Akira: {err}</div></main>;
  if (!dash) return <main className="ops"><div className="empty">loading…</div></main>;

  const tz = dash.owner.timezone;
  const h = dash.health;
  const stale = Object.values(dash.devices.devices);

  return (
    <main className="ops">
      <header className="ops-head">
        <h1><span className={`dot ${dash.assistant.status}`} /> Akira · operations room</h1>
        <div className="meta">
          <span>{dash.assistant.status}</span>
          <span>{clock} {tz}</span>
          <span>state {ago(dash.generatedAt)}</span>
          <span>last cycle: {dash.now.lastCycle ? `${dash.now.lastCycle.cycle} ${ago(dash.now.lastCycle.ts)}` : "—"}</span>
          <span>{dash.assistant.email}</span>
        </div>
      </header>

      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      <section className="stats">
        {[
          ["journal entries", dash.counts.journalEntries],
          ["documents", dash.counts.documents],
          ["upcoming", dash.counts.calendarUpcoming],
          ["reminders", dash.counts.remindersOpen],
          ["mentions", dash.counts.mentions],
          ["drafts", dash.counts.drafts],
          ["questions", dash.counts.questions],
        ].map(([l, n]) => (
          <div className="stat" key={String(l)}><div className="n">{n}</div><div className="l">{l}</div></div>
        ))}
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Now <span>{dash.now.working.length ? "attention" : "all quiet"}</span></h2>
          <ul className="list">
            {dash.now.working.map((w) => <li key={w}><span className="t">!</span><span>{w}</span></li>)}
            {dash.now.nextCycles.map((c) => <li key={c.name}><span className="t">{c.every}</span><span>{c.name}</span></li>)}
          </ul>
          <div className="note">
            <textarea placeholder="Tell Akira something. It goes into her inbox and the permanent record." value={note} onChange={(e) => setNote(e.target.value)} />
            <button onClick={sendNote} disabled={sending || !note.trim()}>{sending ? "…" : "Send"}</button>
          </div>
        </div>

        <div className="panel">
          <h2>Priorities <span>{dash.priorities.date || "not set"}</span></h2>
          {dash.priorities.items.length ? (
            <ul className="list">
              {dash.priorities.items.map((p) => (
                <li key={p.rank}><span className="rank">{p.rank}</span><span>{p.text}<span className={`tag ${p.status}`}>{p.status}</span><span className="sub">{p.why}</span></span></li>
              ))}
            </ul>
          ) : <Empty text="no priorities yet — set after the first daily brief" />}
          {dash.priorities.notes && <p className="sub" style={{ color: "var(--muted)", fontSize: 13 }}>{dash.priorities.notes}</p>}
        </div>

        <div className="panel">
          <h2>Calendar <span>{dash.calendar.length} upcoming</span></h2>
          {dash.calendar.length ? (
            <ul className="list">{dash.calendar.slice(0, 15).map((e) => <li key={e.id}><span className="t">{fmt(e.start, tz)}</span><span>{e.title}{e.location && <span className="sub">{e.location}</span>}</span></li>)}</ul>
          ) : <Empty />}
        </div>

        <div className="panel">
          <h2>Reminders <span>{dash.reminders.length} open</span></h2>
          {dash.reminders.length ? (
            <ul className="list">{dash.reminders.slice(0, 15).map((r) => <li key={r.id}><span className="t">{fmt(r.due, tz)}</span><span>{r.text}<span className={`tag ${r.priority}`}>{r.priority}</span></span></li>)}</ul>
          ) : <Empty />}
        </div>

        <div className="panel">
          <h2>Health <span>{h.latest.asOf ? `as of ${fmt(h.latest.asOf, tz)}` : "no data yet"}</span></h2>
          <div className="health-grid">
            {[
              ["steps", h.latest.steps, ""],
              ["resting HR", h.latest.restingHeartRate, " bpm"],
              ["HRV", h.latest.hrv, " ms"],
              ["sleep", h.latest.sleepHours, " h"],
              ["exercise", h.latest.exerciseMinutes, " min"],
              ["SpO₂", h.latest.bloodOxygen, "%"],
            ].map(([l, v, u]) => (
              <div className="hv" key={String(l)}><div className="n">{typeof v === "number" ? `${Math.round(v * 10) / 10}${u}` : "—"}</div><div className="l">{l}</div></div>
            ))}
          </div>
          <Spark data={h.daily} k="restingHeartRate" />
          <Spark data={h.daily} k="sleepHours" />
          {h.flags.length ? (
            <ul className="list" style={{ marginTop: 8 }}>{h.flags.slice(0, 5).map((f, i) => <li key={i}><span className="t">{fmt(f.ts, tz)}</span><span>{f.text}<span className={`tag ${f.level}`}>{f.level}</span></span></li>)}</ul>
          ) : null}
        </div>

        <div className="panel">
          <h2>Devices <span>{stale.length} known</span></h2>
          {stale.length ? (
            <div className="devices">
              {stale.map((d) => {
                const mins = d.lastSeen ? (Date.now() - Date.parse(d.lastSeen)) / 60_000 : Infinity;
                const cls = !d.lastSeen ? "unknown" : mins > 30 ? "stale" : "";
                return (
                  <div className="dev" key={d.id}>
                    <div className="l"><span className={`led ${cls}`} />{d.label}</div>
                    <div className="s">{ago(d.lastSeen)}{typeof d.battery === "number" ? ` · ${Math.round(d.battery)}%` : ""}</div>
                    {d.summary && <div className="s">{d.summary}</div>}
                  </div>
                );
              })}
            </div>
          ) : <Empty text="no device has checked in yet — install the Mac agent and the iPhone shortcuts" />}
        </div>

        <div className="panel">
          <h2>Said about Amos online <span>{dash.mentions.lastRunAt ? `swept ${ago(dash.mentions.lastRunAt)}` : "not swept yet"}</span></h2>
          {dash.mentions.items.length ? (
            <ul className="list">{dash.mentions.items.slice(0, 10).map((m) => <li key={m.id}><span className="t">{fmt(m.publishedAt ?? m.foundAt, tz, { month: "short", day: "numeric" })}</span><span><a href={m.url} target="_blank" rel="noreferrer noopener">{m.title}</a><span className={`tag ${m.severity}`}>{m.severity}</span><span className={`tag ${m.sentiment}`}>{m.sentiment}</span><span className="sub">{m.summary}</span></span></li>)}</ul>
          ) : <Empty />}
        </div>

        <div className="panel">
          <h2>Waiting on Amos <span>{dash.questions.length} questions · {dash.drafts.filter((d) => d.status === "draft").length} drafts</span></h2>
          {dash.questions.length || dash.drafts.length ? (
            <ul className="list">
              {dash.questions.map((q) => <li key={q.id}><span className="t">?</span><span>{q.text}<span className="sub">{q.context}</span></span></li>)}
              {dash.drafts.filter((d) => d.status === "draft").map((d) => <li key={d.id}><span className="t">draft</span><span>To {d.to}: {d.subject}<span className="sub">{d.why} · {d.file}</span></span></li>)}
            </ul>
          ) : <Empty />}
        </div>

        <div className="panel wide">
          <h2>Journal <span>latest {dash.journalRecent.length} of {dash.counts.journalEntries}</span></h2>
          <div className="feed">
            {dash.journalRecent.map((j) => <div key={j.id}><span className="t">{fmt(j.ts, tz, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {j.kind}</span><span>{j.summary}</span></div>)}
          </div>
        </div>

        <div className="panel">
          <h2>Akira activity</h2>
          <div className="feed">
            {dash.activity.map((a, i) => <div key={i}><span className="t">{fmt(a.ts, tz, { hour: "2-digit", minute: "2-digit", second: "2-digit" })} {a.cycle}</span><span>{a.action}: {a.detail}</span></div>)}
          </div>
        </div>

        <div className="panel">
          <h2>Long-term memory <span>MEMORY.md</span></h2>
          <pre className="mem">{dash.memoryExcerpt}</pre>
        </div>
      </section>
    </main>
  );
}
