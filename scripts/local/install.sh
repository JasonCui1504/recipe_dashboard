#!/bin/zsh
# Run this yourself. Builds the cookbook and installs launchd agents, like the
# finance dashboard:
#   com.cookbook.server  - the cookbook on 127.0.0.1:4173, started at login and
#                          restarted if it ever stops
#   com.cookbook.backup  - daily 21:00 copy of the database to ~/cookbook-backups
#                          (runs at next wake if the Mac was asleep)
# If the finance dashboard's own Llama server (~/.finance-ollama) is installed,
# the cookbook's optional AI defaults to it (127.0.0.1:11435); you still turn
# AI on yourself in Settings. Remove everything with scripts/local/uninstall.sh.
# Re-run after pulling new code to rebuild and restart.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NPM="$(which npm)"; NODEDIR="$(dirname "$(which node)")"
AGENTS="$HOME/Library/LaunchAgents"; LOGS="$HOME/Library/Logs"
mkdir -p "$AGENTS" "$LOGS"

cd "$ROOT"
npm install --no-audit --no-fund
npm run build

OLLAMA_URL="http://127.0.0.1:11434"
[[ -x "$HOME/.finance-ollama/bin/ollama" ]] && OLLAMA_URL="http://127.0.0.1:11435"

cat > "$AGENTS/com.cookbook.server.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.cookbook.server</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$NODEDIR:/usr/bin:/bin</string>
    <key>PORT</key><string>4173</string>
    <key>COOKBOOK_OLLAMA_URL</key><string>$OLLAMA_URL</string>
  </dict>
  <key>ProgramArguments</key><array><string>$NPM</string><string>run</string><string>start</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/cookbook-server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/cookbook-server.log</string>
</dict></plist>
PLIST

cat > "$AGENTS/com.cookbook.backup.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.cookbook.backup</string>
  <key>ProgramArguments</key><array><string>$ROOT/scripts/local/backup.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOGS/cookbook-backup.log</string>
  <key>StandardErrorPath</key><string>$LOGS/cookbook-backup.log</string>
</dict></plist>
PLIST

for n in server backup; do
  launchctl bootout "gui/$UID/com.cookbook.$n" 2>/dev/null || true
  # bootout returns before the old job is fully gone; bootstrapping too soon
  # fails with "Bootstrap failed: 5: Input/output error".
  for _ in {1..50}; do
    launchctl print "gui/$UID/com.cookbook.$n" >/dev/null 2>&1 || break
    sleep 0.2
  done
  launchctl bootstrap "gui/$UID" "$AGENTS/com.cookbook.$n.plist"
done
echo "Cookbook: http://127.0.0.1:4173"
