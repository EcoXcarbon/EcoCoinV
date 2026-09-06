# ── Stage 1: Install dependencies ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# ── Stage 2: Production image ──
FROM node:22-alpine AS runtime
WORKDIR /app

RUN addgroup -S nsplms && adduser -S nsplms -G nsplms

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

RUN mkdir -p uploads && chown -R nsplms:nsplms /app

USER nsplms

EXPOSE 5010

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:5010/api/health || exit 1

CMD ["node", "src/index.js"]
