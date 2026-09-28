---
name: akira
description: Operate, extend or debug Akira, Amos's always-on AI chief of staff living in this repo. Use for anything about Akira's brain, memory, journal, cycles, the /akira operations room, ingest endpoints, device integrations, or when asked to remember/track/archive something for Amos.
---

# Akira operating procedures

## Where things are
| need | path |
|---|---|
| persona / rules | `akira/SOUL.md`, `akira/brain/rules/` |
| Amos's details, search queries, calendars, devices | `akira/brain/identity.json` |
| long-term memory | `akira/brain/memory/MEMORY.md` (curated), `memory/people/*.md`, `memory/projects/*.md` |
| permanent record | `akira/brain/memory/journal/YYYY-MM-DD.jsonl` (append-only), `memory/raw/` |
| what the dashboard shows | `akira/brain/state/*.json`, built by `src/lib/dashboard.ts` |
| documents + chain of custody | `akira/brain/documents/incoming/`, `MANIFEST.jsonl` |
| cycles | `akira/src/cycles/*.ts`, dispatched by `akira/src/index.ts` |
| tools the model can call | `akira/src/tools.ts` |
| schedule | `.github/workflows/akira.yml` |
| site endpoints | `site/app/api/akira/{ingest,email,state,calendar}/route.ts`, gate in `site/proxy.ts` |

## Remember something for Amos (from a chat session)
1. Append a journal line with `kind`, `source`, `summary`, ISO `ts` (use `brain.journal()` via a tiny tsx script, or write the JSONL line by hand in today's file).
2. If durable, add a bullet under the right section of `MEMORY.md` with `_(src: …)_`.
3. Never edit or delete existing lines. Commit with a `[akira]`-free message (workflow commits use that prefix).

## Archive a document
`storeDocument({bytes, originalName, source})` in `akira/src/lib/brain.ts` writes the file and the manifest line; then journal a one-paragraph neutral summary with the manifest id. Or POST it to `/api/akira/ingest?source=document` as `{name, base64}` and let the heartbeat do it.

## Add a capability
- New data source → POST to `/api/akira/ingest` with a `source` from `IngestSource` (`akira/src/lib/types.ts`); add a deterministic handler in `process-inbox.ts` if it is telemetry, otherwise the model digests it.
- New action Akira can take → add a `betaZodTool` in `tools.ts` that journals its effect; include it in the relevant cycle's `tools` list.
- New cycle → `akira/src/cycles/<name>.ts`, register in `index.ts`, add a cron line and a `case` in `akira.yml`, add it to `SCHEDULE` in `dashboard.ts`.
- New dashboard panel → extend `Dashboard` in `types.ts`, `buildDashboard()`, and `site/app/akira/ops-room.tsx`.

## Debug
- Cycle failures are journaled with `tags: ["error"]` and shown in the Activity panel.
- `AKIRA_ROOT=/tmp/copy AKIRA_DRY_RUN=1 npx tsx src/index.ts heartbeat` runs against a copy.
- Site returns 404 on `/akira` when `AKIRA_DASHBOARD_KEY` is unset in production (by design).

## Model
Cycles use `claude-opus-5` with adaptive thinking through `client.beta.messages.toolRunner`; `AKIRA_MODEL` overrides. Server web search (`web_search_20260209`) is used only in `web-monitor`; the runner resumes `pause_turn` in `src/lib/claude.ts`.
