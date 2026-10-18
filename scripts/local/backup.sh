#!/bin/zsh
# Daily backup (run by launchd at 21:00, or by hand any time): a consistent
# copy of the database to ~/cookbook-backups/cookbook-YYYY-MM-DD.db, keeping
# the newest 30, plus a mirror of uploaded photos.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$HOME/cookbook-backups"
mkdir -p "$DEST"
[[ -f "$ROOT/data/cookbook.db" ]] || { echo "No database yet at $ROOT/data/cookbook.db"; exit 0; }
/usr/bin/sqlite3 "$ROOT/data/cookbook.db" ".backup '$DEST/cookbook-$(date +%F).db'"
[[ -d "$ROOT/data/uploads" ]] && /usr/bin/rsync -a "$ROOT/data/uploads/" "$DEST/uploads/"
ls -1t "$DEST"/cookbook-*.db | tail -n +31 | while read -r f; do rm -f "$f"; done
echo "$(date '+%F %T') backed up to $DEST/cookbook-$(date +%F).db"
