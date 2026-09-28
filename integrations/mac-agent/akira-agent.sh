#!/usr/bin/env bash
# Akira Mac agent: heartbeat + forward new AI-agent conversations + drop-folder documents.
# Runs every 5 minutes via launchd (see install.sh). Needs: curl, jq (brew install jq).
set -euo pipefail

CONF="${HOME}/.config/akira/agent.env"
[ -f "$CONF" ] && . "$CONF"
: "${AKIRA_URL:=https://artistsonly.io}"
: "${AKIRA_INGEST_SECRET:?set AKIRA_INGEST_SECRET in $CONF}"
: "${AKIRA_DEVICE_ID:=$(scutil --get ComputerName 2>/dev/null | tr -c 'A-Za-z0-9' '-' | tr 'A-Z' 'a-z' | sed 's/-*$//')}"
STATE_DIR="${HOME}/.config/akira/state"; mkdir -p "$STATE_DIR"
DROP="${HOME}/Akira/inbox"; SENT="${HOME}/Akira/sent"; mkdir -p "$DROP" "$SENT"

post() { # $1 = query string, stdin = json
  curl -sS -m 30 -X POST "${AKIRA_URL}/api/akira/ingest?$1" -H "Authorization: Bearer ${AKIRA_INGEST_SECRET}" -H 'Content-Type: application/json' --data-binary @- >/dev/null
}

# 1) Heartbeat: battery, active app, idle time, wifi name.
BATT=$(pmset -g batt 2>/dev/null | grep -o '[0-9]*%' | tr -d '%' | head -1)
APP=$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null || echo "")
IDLE=$(ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')
jq -cn --arg id "$AKIRA_DEVICE_ID" --arg app "$APP" --arg idle "${IDLE:-}" --arg batt "${BATT:-}" \
  '{source:"device", device:$id, type:"heartbeat", payload:{kind:"computer", label:$id, battery:(if $batt=="" then null else ($batt|tonumber) end), summary:("active: "+$app+" · idle "+$idle+"s"), extra:{app:$app, idleSeconds:$idle}}}' | post "source=device&device=${AKIRA_DEVICE_ID}"

# 2) Claude Code conversations: forward new lines from every session transcript.
CC="${HOME}/.claude/projects"
if [ -d "$CC" ]; then
  find "$CC" -name '*.jsonl' -mmin -10 2>/dev/null | while read -r f; do
    key=$(echo "$f" | shasum | cut -c1-16); off_file="$STATE_DIR/cc-$key.off"; off=$(cat "$off_file" 2>/dev/null || echo 0)
    size=$(stat -f%z "$f"); [ "$size" -le "$off" ] && continue
    tail -c +$((off + 1)) "$f" | grep -E '"type":"(user|assistant)"' | jq -c 'select(.message != null) | {role:.message.role, text:(if (.message.content|type)=="string" then .message.content else ([.message.content[]? | select(.type=="text") | .text] | join("\n")) end), ts:.timestamp}' 2>/dev/null \
      | jq -sc --arg f "$f" --arg id "$AKIRA_DEVICE_ID" 'select(length>0) | {source:"conversation", device:$id, type:"claude-code", payload:{agent:"claude-code", transcript:$f, project:($f|split("/")[-2]), messages:.}}' \
      | { read -r body || true; [ -n "${body:-}" ] && printf '%s' "$body" | post "source=conversation&device=${AKIRA_DEVICE_ID}"; }
    echo "$size" > "$off_file"
  done
fi

# 3) Drop folder: anything put in ~/Akira/inbox is archived with chain of custody, then moved to ~/Akira/sent.
find "$DROP" -type f -size -8M 2>/dev/null | while read -r f; do
  name=$(basename "$f")
  jq -cn --arg name "$name" --arg b64 "$(base64 < "$f" | tr -d '\n')" --arg id "$AKIRA_DEVICE_ID" \
    '{source:"document", device:$id, type:"drop-folder", payload:{name:$name, base64:$b64, note:"dropped in ~/Akira/inbox"}}' | post "source=document&device=${AKIRA_DEVICE_ID}" && mv "$f" "$SENT/$(date +%Y%m%d-%H%M%S)-$name"
done

# 4) Text notes: ~/Akira/notes.txt — each non-empty line appended since last run becomes a note.
NOTES="${HOME}/Akira/notes.txt"
if [ -f "$NOTES" ]; then
  off=$(cat "$STATE_DIR/notes.off" 2>/dev/null || echo 0); size=$(stat -f%z "$NOTES")
  if [ "$size" -gt "$off" ]; then
    tail -c +$((off + 1)) "$NOTES" | grep -v '^\s*$' | jq -R -c --arg id "$AKIRA_DEVICE_ID" '{source:"note", device:$id, type:"notes-file", payload:{text:.}}' | jq -sc '.' | post "source=note&device=${AKIRA_DEVICE_ID}"
    echo "$size" > "$STATE_DIR/notes.off"
  fi
fi
