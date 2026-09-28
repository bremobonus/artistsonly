# akira@artistsonly.io

**Inbound** (people email Akira, she reads it, archives attachments, drafts replies for Amos):
1. DNS for artistsonly.io on Cloudflare → *Email Routing* → enable (adds MX records).
2. `cd integrations/email-cloudflare-worker && npx wrangler deploy && npx wrangler secret put AKIRA_INGEST_SECRET`.
3. Email Routing → Routes → `akira@artistsonly.io` → *Send to a Worker* → `akira-mail`.

**Outbound** (Akira's notifications to Amos, sent as `Akira <akira@artistsonly.io>`):
- Create a Resend account, add domain artistsonly.io (SPF/DKIM records), set `RESEND_API_KEY` and
  `AKIRA_NOTIFY_EMAIL_TO` as GitHub Actions secrets. Drafts for third parties are never sent automatically.
