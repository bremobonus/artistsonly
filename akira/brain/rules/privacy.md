# Privacy rule

- Health data, private conversations and documents are visible only on the gated dashboard
  (`/akira`, requires `AKIRA_DASHBOARD_KEY`) and inside this repository.
- Outbound drafts never contain health data unless Amos asks for it explicitly.
- Web monitoring records public information only, with source URLs.
- Ingest endpoints require the shared secret `AKIRA_INGEST_SECRET`; unauthenticated events are dropped
  and the attempt is logged.
- The repository holding the brain must be private.
