# Mac agent

Runs every 5 minutes via launchd and sends Akira:

1. **Heartbeat** — battery, frontmost app, idle time (shows on the Devices panel).
2. **Claude Code conversations** — new lines from `~/.claude/projects/**/*.jsonl` (all sessions, all projects).
3. **Documents** — any file dropped in `~/Akira/inbox` (archived with SHA-256 chain of custody, then moved to `~/Akira/sent`).
4. **Notes** — lines appended to `~/Akira/notes.txt`.

Install: `bash install.sh` (asks for the ingest secret once). Repeat on every computer with a different device id.

Other AI agents: export their conversations (ChatGPT → Settings → Data controls → Export; Cursor/Windsurf logs, etc.)
into `~/Akira/inbox` and they are archived and read. For anything with an API or a webhook, POST to
`/api/akira/ingest?source=conversation&device=<name>` with `{ "payload": { "agent": "...", "messages": [...] } }`.

Linux/Windows: the script is plain bash + curl + jq; replace `pmset`/`osascript`/`stat -f%z` with the local equivalents
and schedule with cron or Task Scheduler.
