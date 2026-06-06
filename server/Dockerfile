FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5175 \
    FORART_APP_TITLE=Forart \
    FORART_CONFIG_DIR=/data/config \
    FORART_DATA_DIR=/data/library \
    FORART_REVIEW_DIR=/data/review

WORKDIR /app

COPY package.json ./
COPY forart-server.mjs ./
COPY api-contract ./api-contract

VOLUME ["/data"]
EXPOSE 5175

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5175/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start"]
