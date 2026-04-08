#!/usr/bin/env bash
# Serve the production build of excalidraw-app
# Used by pm2 — avoids PATH/fnm issues by using absolute paths

FNM_BIN="$HOME/.local/share/fnm/node-versions/v25.8.1/installation/bin"
EXCALIDRAW_DIR="$(cd "$(dirname "$0")/.." && pwd)"

exec "$FNM_BIN/npx" serve "$EXCALIDRAW_DIR/excalidraw-app/build" -l 8170
