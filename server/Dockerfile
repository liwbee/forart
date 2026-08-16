FROM node:24-bookworm-slim AS admin-builder

WORKDIR /build

COPY package.json ./
COPY package-lock.json ./
RUN npm ci

COPY admin-app ./admin-app
RUN npm run build:admin

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=6980 \
    PGHOST="" \
    PGPORT=5432 \
    PGDATABASE=forart \
    PGUSER=forart \
    PGPASSWORD="" \
    FORART_ADMIN_PASSWORD="" \
    FORART_DATA_DIR=/forart_data \
    FORART_LIBRARY_DIR=/library \
    FORART_LANGUAGE=zh-CN

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev

COPY forart-server.mjs ./
COPY src ./src
COPY scripts ./scripts
COPY --from=admin-builder /build/admin ./admin

VOLUME ["/library", "/forart_data"]
EXPOSE 6980

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const port = process.env.PORT || '6980'; fetch('http://127.0.0.1:' + port + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "forart-server.mjs"]
