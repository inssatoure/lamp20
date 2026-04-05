#!/bin/bash
# LAMP AI Bot - Safe Start Script
# Kills ALL existing node instances running app.js, then starts one clean instance

APP_DIR="/home/metawbms/lamp.metafrik.com"
NODE="/opt/alt/alt-nodejs20/root/usr/bin/node"
LOGFILE="$APP_DIR/logs/app.log"
PIDFILE="$APP_DIR/lamp_bot.pid"

echo "🛑 Stopping all existing bot instances..."
# Kill by PID file if exists
if [ -f "$PIDFILE" ]; then
  kill -9 $(cat "$PIDFILE") 2>/dev/null
  rm -f "$PIDFILE"
fi

# Also kill any stray node processes running app.js
pkill -9 -f "node.*app.js" 2>/dev/null
sleep 2

echo "🚀 Starting LAMP AI Bot..."
export TELEGRAM_TOKEN="8718768067:AAGKmBVB67nK6feFZn8Arv3cuySBLpfmW9A"
export GEMINI_API_KEY="AIzaSyC2RHHJy4PkNOYfHWQrbucLOrDZFg0YY3o"

nohup $NODE $APP_DIR/app.js > $LOGFILE 2>&1 &
echo $! > "$PIDFILE"
echo "✅ Bot started with PID $(cat $PIDFILE)"
