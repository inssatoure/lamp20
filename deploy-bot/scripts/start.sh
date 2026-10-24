#!/bin/bash
# Container start: get what is not in git (once, kept on the /data volume), then start the bot.
set -e
cd /app
mkdir -p /data
if [ ! -s "$LAMP_SOURCES_DIR/quran-uthmani.json" ]; then
  echo "[start] downloading the Quran and hadith sources…"
  LAMP_ROOT_DIR=/data node scripts/fetch-sources.mjs
fi
if [ ! -s "$LAMP_INDEX_FILE" ]; then
  echo "[start] downloading the Khassaid meaning index…"
  node deploy-bot/scripts/get-index.mjs "$LAMP_INDEX_FILE"
fi
cd deploy-bot
exec node app.js
