#!/bin/bash
# PM2 ecosystem config for LAMP AI Bot
pkill -9 -f 'node.*app.js' 2>/dev/null
sleep 2
/home/metawbms/node_modules/.bin/pm2 delete lamp-bot 2>/dev/null
sleep 1
TELEGRAM_TOKEN='8718768067:AAGKmBVB67nK6feFZn8Arv3cuySBLpfmW9A' \
GEMINI_API_KEY='AIzaSyC2RHHJy4PkNOYfHWQrbucLOrDZFg0YY3o' \
/home/metawbms/node_modules/.bin/pm2 start /home/metawbms/lamp.metafrik.com/app.js \
  --name lamp-bot \
  --interpreter /opt/alt/alt-nodejs20/root/usr/bin/node \
  --restart-delay=5000 \
  --log /home/metawbms/lamp.metafrik.com/logs/app.log \
  --merge-logs
/home/metawbms/node_modules/.bin/pm2 save
echo "=== PM2 STATUS ==="
/home/metawbms/node_modules/.bin/pm2 list
