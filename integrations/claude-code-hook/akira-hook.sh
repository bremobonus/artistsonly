#!/usr/bin/env bash
# Claude Code "Stop" hook: forwards the just-finished turn's transcript path to Akira in real time.
# The Mac agent also syncs transcripts every 5 minutes; this hook makes it immediate.
set -euo pipefail
CONF="${HOME}/.config/akira/agent.env"; [ -f "$CONF" ] && . "$CONF"
: "${AKIRA_URL:=https://artistsonly.io}"; : "${AKIRA_INGEST_SECRET:?}"; : "${AKIRA_DEVICE_ID:=claude-code}"
input=$(cat)
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
[ -z "$transcript" ] && exit 0
tail -n 40 "$transcript" | grep -E '"type":"(user|assistant)"' | jq -c 'select(.message != null) | {role:.message.role, text:(if (.message.content|type)=="string" then .message.content else ([.message.content[]? | select(.type=="text") | .text] | join("\n")) end), ts:.timestamp}' 2>/dev/null \
 | jq -sc --arg f "$transcript" --arg id "$AKIRA_DEVICE_ID" 'select(length>0) | {source:"conversation", device:$id, type:"claude-code-stop", payload:{agent:"claude-code", transcript:$f, messages:.}}' \
 | curl -sS -m 15 -X POST "${AKIRA_URL}/api/akira/ingest" -H "Authorization: Bearer ${AKIRA_INGEST_SECRET}" -H 'Content-Type: application/json' --data-binary @- >/dev/null || true
exit 0
