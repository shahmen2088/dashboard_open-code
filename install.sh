#!/usr/bin/env sh
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OPENCODE_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
STORE="${OPENCODE_SESSION_ORGANIZER_HOME:-$OPENCODE_DIR/session-organizer}"

mkdir -p "$PLUGIN_DIR" "$STORE"
if command -v opencode >/dev/null 2>&1 && opencode --version 2>/dev/null | grep -q 'v2\.'; then
  printf '%s\n' 'Detected OpenCode V2. The legacy V1 plugin was not copied; run npm run start:efficiency.'
else
  cp "$REPO"/src/*.js "$PLUGIN_DIR/"
  printf 'Installed Session Organizer V1 plugin: %s\n' "$PLUGIN_DIR/session-organizer.js"
fi

if [ ! -f "$STORE/settings.json" ]; then
  cp "$REPO/config/settings.example.json" "$STORE/settings.json"
fi

printf 'Local data directory: %s\n' "$STORE"
