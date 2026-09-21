#!/bin/sh
# Costruisce PizzaManager.app e la installa in /Applications.
#
# L'app installata è una fotografia del codice al momento del build: dopo un
# merge va rifatta, ed è questo lo script da lanciare (`npm run install:mac`).
# Costruita in locale non passa da Gatekeeper (niente attributo di quarantena),
# quindi si apre senza avvisi anche senza firma.
set -eu
cd "$(dirname "$0")/.."

APP_NAME="PizzaManager"
DEST="/Applications/$APP_NAME.app"

# Due istanze (questa e `npm start`, o la vecchia copia installata) sarebbero
# due client sullo stesso socket tmux e sulla stessa cartella dati.
if pgrep -f "$DEST/Contents/MacOS/" >/dev/null 2>&1; then
  echo "$APP_NAME è aperta: chiudila (⌘Q) e rilancia." >&2
  exit 1
fi

npm run dist:mac

BUILT=$(ls -d dist/mac*/"$APP_NAME.app" 2>/dev/null | head -1)
if [ -z "$BUILT" ]; then
  echo "Build finita ma non trovo $APP_NAME.app in dist/" >&2
  exit 1
fi

rm -rf "$DEST"
ditto "$BUILT" "$DEST"
echo "Installata: $DEST"
