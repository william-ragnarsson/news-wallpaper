#!/bin/sh
# Render the wallpaper headlessly to a PNG so a design can be checked without a browser.
#   tools/snap.sh <preset> [WIDTHxHEIGHT] [follow] [out.png]
#   tools/snap.sh broadsheet 1512x982
#   tools/snap.sh cover 2560x1440 1792663198457
#   QUERY='&dock=0' tools/snap.sh newsprint 1512x982   (extra URL params)
# Needs the dev server running (npm run dev). Set CHROME to use another Chromium binary.
set -e
PRESET=${1:?usage: tools/snap.sh <preset> [WIDTHxHEIGHT] [follow] [out.png]}
SIZE=${2:-1512x982}
FOLLOW=${3:-auto}
OUT=${4:-snapshots/$PRESET-$SIZE-$FOLLOW.png}
W=${SIZE%x*}
H=${SIZE#*x}
CHROME=${CHROME:-$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell 2>/dev/null | tail -1)}
[ -x "$CHROME" ] || { echo "No headless Chromium found; set CHROME=/path/to/chrome" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$W,$H" --virtual-time-budget=12000 --screenshot="$OUT" \
  "http://localhost:${PORT:-4174}/?preset=$PRESET&follow=$FOLLOW&hud=0${QUERY}" >/dev/null 2>&1
echo "$OUT"
