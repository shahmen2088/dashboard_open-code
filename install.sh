#!/usr/bin/env sh
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OPENCODE_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
STORE="${OPENCODE_SESSION_ORGANIZER_HOME:-$OPENCODE_DIR/session-organizer}"

mkdir -p "$PLUGIN_DIR" "$STORE"
if [ ! -f "$REPO/dist/session-organizer.js" ]; then
  printf '%s\n' 'dist/session-organizer.js is missing. Run npm install and npm run build first.' >&2
  exit 1
fi
cp "$REPO/dist/session-organizer.js" "$PLUGIN_DIR/session-organizer.js"

if [ ! -f "$STORE/settings.json" ]; then
  cp "$REPO/config/settings.example.json" "$STORE/settings.json"
fi

printf 'Installed Session Organizer plugin: %s\n' "$PLUGIN_DIR/session-organizer.js"
printf 'Local data directory: %s\n' "$STORE"
printf '%s\n' 'Restart OpenCode, then run session_organizer_audit.'
