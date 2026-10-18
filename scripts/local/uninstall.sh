#!/bin/zsh
# Stops the cookbook and removes its launchd agents. Your data in data/ and the
# backups in ~/cookbook-backups are left alone.
for n in server backup; do
  launchctl bootout "gui/$UID/com.cookbook.$n" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.cookbook.$n.plist"
done
