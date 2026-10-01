# artistsonly.io + Akira

**Akira** is Amos's always-on AI chief of staff. Her brain, memory and record live in this repo under
`akira/brain`; her operations room is the hidden page **https://artistsonly.io/akira**; her address is
**akira@artistsonly.io**.

```
akira/                 Akira runtime + brain
  SOUL.md              who she is, what she does, rules she never breaks
  brain/
    identity.json      Amos's details, timezone, search queries, calendars, devices  ← fill this in
    memory/MEMORY.md   curated long-term memory
    memory/journal/    append-only daily record (JSONL). Never edited, never deleted
    memory/inbox/      events landed by the site, waiting for Akira
    memory/raw/        every raw event after processing, forever
    memory/people/     one file per person
    state/             calendar, reminders, priorities, health, devices, mentions, drafts, questions, dashboard
    documents/         archived files + MANIFEST.jsonl (SHA-256 chain of custody)
    rules/             retention (never forget) and privacy
  src/                 cycles: heartbeat, web-monitor, daily-brief, health-review, compact-memory
site/                  artistsonly.io (Next.js). /akira operations room, /api/akira/* endpoints
integrations/          Mac agent, Claude Code hook, iPhone/Watch shortcuts, email worker
.github/workflows/     Akira's schedule (always on) and CI
```

## How Akira is always on
GitHub Actions runs her on a schedule and commits the brain back to `main`:

| cycle | when | what |
|---|---|---|
| heartbeat | every 15 min, and within ~1 min of any new event | sync calendars, read the inbox, extract dates/commitments/people/facts, fire due reminders |
| web-monitor | hourly | search the web for what is being said about Amos and artistsonly.io |
| daily-brief | 07:00 Toronto | priorities for the day, calendar, reminders, health, questions, drafts → push + email |
| health-review | Sunday | 90-day trends from Apple Watch data |
| compact-memory | Sunday | tidy MEMORY.md (old version journaled first) |

Every write goes through the journal. Every file received gets a manifest line with its hash.

## Data in → Akira
| from | how |
|---|---|
| iPhone / Apple Watch health | Health Auto Export → `POST /api/akira/ingest?source=apple_health` (see `integrations/ios`) |
| iPhone heartbeat, share sheet | Shortcuts (see `integrations/ios`) |
| every Mac / computer | `integrations/mac-agent` (heartbeat, Claude Code transcripts, `~/Akira/inbox` drop folder, `~/Akira/notes.txt`) |
| Claude Code, real time | `integrations/claude-code-hook` |
| other AI agents | export → drop folder, or POST `source=conversation` |
| email to akira@artistsonly.io | Cloudflare Email Worker → `/api/akira/email` (attachments archived) |
| Amos's Gmail | `gmail-sync` every heartbeat, read-only scope |
| Google Calendar | pulled every heartbeat; events Akira creates are pushed to the primary calendar |
| the dashboard | "Tell Akira" box on `/akira` |
| the internet | web-monitor cycle |

## Data out
- `/akira` operations room (gated by `AKIRA_DASHBOARD_KEY`, `noindex`, 404 to anyone else).
- Calendar feed `/api/akira/calendar?k=…` to subscribe to in Apple/Google Calendar.
- Push via ntfy. Email sent as akira@artistsonly.io via Resend; every send is journaled with its full text and kept in `akira/brain/state/drafts/` with status `sent`.

## Setup (one time)
1. **Secrets.** Generate two long random strings: `AKIRA_DASHBOARD_KEY`, `AKIRA_INGEST_SECRET`.
2. **Site on Vercel.** Import this repo, *Root Directory* = `site`, add env vars from `.env.example`
   (`GITHUB_TOKEN` = fine-grained PAT for this repo with Contents read/write). Point artistsonly.io at it.
3. **Actions.** Repo → Settings → Secrets: `ANTHROPIC_API_KEY`, `AKIRA_NTFY_TOPIC`, `RESEND_API_KEY`, `AKIRA_NOTIFY_EMAIL_TO`.
   Settings → Actions → General → *Workflow permissions: Read and write*.
4. **Identity.** Edit `akira/brain/identity.json`: full name, aliases, emails, `webSearchQueries`, ICS URLs, timezone.
5. **Devices.** Run `integrations/mac-agent/install.sh` on each Mac; follow `integrations/ios/README.md` on the phone.
6. **Email.** Follow `integrations/email-cloudflare-worker/README.md`.
7. Open `https://artistsonly.io/akira?k=<AKIRA_DASHBOARD_KEY>` once; the cookie keeps you in.
8. **Google** (Gmail read-only, Calendar events): Google Cloud Console → new project → enable *Gmail API* and
   *Google Calendar API* → Credentials → OAuth client, type *Desktop app*. On your Mac:
   `cd akira && GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… npm run google-auth`, approve, and add the printed
   `GOOGLE_REFRESH_TOKEN` with the id and secret as Actions secrets.

Keep this repository **private**: it is Amos's memory.

## Local development
```
npm install --prefix akira && npm install --prefix site
npm test                                   # Akira unit tests
npm run dev                                # site on :3000 reading ../akira/brain from disk
npm run akira -- dashboard                 # rebuild dashboard.json
ANTHROPIC_API_KEY=… npm run akira -- heartbeat
```
