# Claude Code → Akira (real time)

1. `cp akira-hook.sh ~/.config/akira/akira-hook.sh` (the Mac agent installer creates `~/.config/akira/agent.env` with the secret).
2. Merge `settings.snippet.json` into `~/.claude/settings.json`.

Every time a Claude Code turn finishes, the last messages are sent to Akira's inbox. She reads them,
extracts commitments, dates and facts, and keeps the transcript path in the journal.
