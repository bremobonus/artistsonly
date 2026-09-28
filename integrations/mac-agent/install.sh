#!/usr/bin/env bash
# One-time install on each Mac:  bash install.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HOME/.config/akira" "$HOME/Akira/inbox" "$HOME/Akira/sent"
cp "$here/akira-agent.sh" "$HOME/.config/akira/akira-agent.sh"; chmod +x "$HOME/.config/akira/akira-agent.sh"
if [ ! -f "$HOME/.config/akira/agent.env" ]; then
  read -r -p "AKIRA_INGEST_SECRET: " secret
  read -r -p "Device id (e.g. mac-main): " dev
  printf 'AKIRA_URL=https://artistsonly.io\nAKIRA_INGEST_SECRET=%s\nAKIRA_DEVICE_ID=%s\n' "$secret" "$dev" > "$HOME/.config/akira/agent.env"
  chmod 600 "$HOME/.config/akira/agent.env"
fi
command -v jq >/dev/null || { echo "installing jq"; brew install jq; }
sed "s#__HOME__#$HOME#g" "$here/com.artistsonly.akira.plist" > "$HOME/Library/LaunchAgents/com.artistsonly.akira.plist"
launchctl unload "$HOME/Library/LaunchAgents/com.artistsonly.akira.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/com.artistsonly.akira.plist"
echo "Akira agent installed. Runs every 5 min. Log: ~/.config/akira/agent.log"
echo "Drop files in ~/Akira/inbox, write lines to ~/Akira/notes.txt."
