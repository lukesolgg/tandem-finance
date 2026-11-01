# ── deps & build ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/* \
 && npm i -g prisma@6 --no-audit --no-fund && useradd -m -u 1001 tandem
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist
RUN chown -R tandem /app
USER tandem
EXPOSE 3000
# Apply migrations on boot, then start. All data lives in Postgres.
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "prisma migrate deploy --schema prisma/schema.prisma && node server.js"]
