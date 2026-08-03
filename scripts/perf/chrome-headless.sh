#!/bin/sh
# Chrome voor containers zonder GPU en zonder display (Claude remote env, CI).
# De harness houdt zijn vaste vlaggenlijst; wat déze omgeving nodig heeft rijdt
# hier mee: CHROME_PATH=scripts/perf/chrome-headless.sh run diagnose.
#
# - headless=new: zonder displayserver mislukt het aanmaken van een
#   WebGL-context in een gewoon venster (ook onder xvfb), headless werkt.
# - swiftshader: er is geen GPU-device. Structurele getallen (lichten in de
#   shader, programma's, draw calls, shader-KB) blijven exact; frametijden
#   zijn de CPU-rasterizer en NOOIT vergelijkbaar met een GPU-snapshot.
# - no-sandbox: de container draait als root en Chrome weigert dat anders.
set -eu
for chrome in \
	"${CHROME_BINARY:-}" \
	"${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"/chromium-*/chrome-linux/chrome \
	/usr/bin/google-chrome \
	/usr/bin/chromium; do
	if [ -n "$chrome" ] && [ -x "$chrome" ]; then
		exec "$chrome" "$@" \
			--headless=new \
			--no-sandbox \
			--use-angle=swiftshader \
			--enable-unsafe-swiftshader \
			--disable-dev-shm-usage
	fi
done
echo "chrome-headless.sh: geen Chrome/Chromium gevonden" >&2
exit 1
