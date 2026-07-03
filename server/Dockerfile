FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=6980 \
    FORART_APP_TITLE=Forart \
    FORART_DATABASE_DIR=/data/.forart/database \
    FORART_DATA_DIR=/data \
    FORART_LANGUAGE=zh-CN

WORKDIR /app

COPY package.json ./
COPY forart-server.mjs ./
COPY src ./src
COPY admin ./admin

VOLUME ["/data"]
EXPOSE 6980

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const port = process.env.PORT || '6980'; fetch('http://127.0.0.1:' + port + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["npm", "run", "start"]
