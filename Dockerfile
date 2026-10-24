# LAMP AI — container for Railway (or any Docker host).
# The code and the Khassaid texts come from the repository. The Quran/hadith sources, the meaning
# index and the users' conversations live on a volume mounted at /data, so they survive redeploys.
# No system package needed: ffmpeg comes with the bot (npm package ffmpeg-static).
FROM node:22-slim
WORKDIR /app
COPY deploy-bot/package.json deploy-bot/package-lock.json deploy-bot/
RUN cd deploy-bot && npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production \
    LAMP_ROOT_DIR=/app \
    LAMP_DATA_DIR=/data/users-data \
    LAMP_SOURCES_DIR=/data/sources \
    LAMP_INDEX_FILE=/data/versets_cache.jsonl
CMD ["bash", "deploy-bot/scripts/start.sh"]
