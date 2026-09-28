# iPhone + Apple Watch → Akira

Apple Watch data flows into the iPhone's Health app. Two apps get it to Akira; no server-side Apple credentials needed.

## A. Health data (recommended: Health Auto Export)
1. Install **Health Auto Export** (App Store). Open *Automations → New → REST API*.
2. URL: `https://artistsonly.io/api/akira/ingest?source=apple_health&device=iphone`
3. Method POST, format JSON, headers: `Authorization: Bearer <AKIRA_INGEST_SECRET>`.
4. Metrics: Steps, Resting Heart Rate, Heart Rate, Heart Rate Variability, Sleep Analysis, Active Energy,
   Exercise Time, Stand Hours, Blood Oxygen, Respiratory Rate, Weight. Aggregation: daily. Period: last 2 days.
5. Schedule: every hour (or every 30 min). Enable *Run in background*.

Akira accepts the app's native `{ "data": { "metrics": [...] } }` shape directly and folds it into `brain/state/health.json`.

## B. Heartbeat / location (Shortcuts)
Create a Shortcut **"Akira heartbeat"**:
- *Get Current Location* (optional) → *Get Battery Level* → *Get Contents of URL*:
  - URL `https://artistsonly.io/api/akira/ingest?source=device&device=iphone`, POST, JSON body
    `{"battery": <Battery Level>, "summary": "<Current Location: City>"}`
  - Header `Authorization: Bearer <AKIRA_INGEST_SECRET>`
- Personal Automation → *Time of Day*, repeat hourly (or *When Apple Watch unlocks iPhone*), run immediately.

## C. "Send to Akira" (share sheet)
Shortcut accepting *Text, URLs, Images, PDFs, Files* from the share sheet:
- If input is text/URL → POST `https://artistsonly.io/api/akira/ingest?source=note&device=iphone` with body `{"text": "<Shortcut Input>"}`.
- Else → *Base64 Encode* the file → POST `...?source=document&device=iphone` with `{"name": "<File Name>", "base64": "<Base64>"}`.
Screenshots of messages, voice memos (transcribed via *Transcribe Audio* first), contracts: all land in the archive with chain of custody.

## D. Calendar
- Subscribe to Akira's calendar: Settings → Calendar → Accounts → Add Subscribed Calendar →
  `https://artistsonly.io/api/akira/calendar?k=<AKIRA_DASHBOARD_KEY>`. Events Akira adds appear on the phone and watch.
- Give Akira your existing calendars: in `akira/brain/identity.json` → `calendars.subscribedIcsUrls`, add the iCloud
  (Calendar → share → Public Calendar) or Google (Settings → Secret address in iCal format) ICS URLs.

## E. Push notifications
Install **ntfy** and subscribe to the topic you set as `AKIRA_NTFY_TOPIC` (pick something unguessable). Reminders and the daily brief arrive there.
