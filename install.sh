#!/usr/bin/env sh
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OPENCODE_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
STORE="${OPENCODE_SESSION_ORGANIZER_HOME:-$OPENCODE_DIR/session-organizer}"

mkdir -p "$PLUGIN_DIR" "$STORE"
cp "$REPO/src/session-organizer.js" "$PLUGIN_DIR/session-organizer.js"

if [ ! -f "$STORE/settings.json" ]; then
  cp "$REPO/config/settings.example.json" "$STORE/settings.json"
fi

printf 'Installed Session Organizer plugin: %s\n' "$PLUGIN_DIR/session-organizer.js"
printf 'Local data directory: %s\n' "$STORE"
printf '%s\n' 'Restart OpenCode, then run session_organizer_audit.'
