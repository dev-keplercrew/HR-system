# Meridian HR (engine-generated HRIS) — single-container demo deploy.
# nginx serves the built SPA and proxies /api -> the Express backend (:4000);
# SQLite via Prisma db push + seed at first boot (zero external infra).
FROM node:20-slim AS build
# openssl must be present BEFORE `prisma generate` (inside `npm run build`):
# without it Prisma's platform detection falls back to debian-openssl-1.1.x,
# while the runtime stage (which installs openssl) resolves 3.0.x -> engine
# mismatch crash at boot.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund
RUN npm run build --workspace backend && npm run build --workspace frontend

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
RUN rm -f /etc/nginx/sites-enabled/default && printf 'server { \
  listen 8080; \
  location /api/ { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host; } \
  location / { root /app/frontend/dist; try_files $uri $uri/ /index.html; } \
}\n' > /etc/nginx/conf.d/default.conf
ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_URL=file:/app/backend/prisma/hris.db
EXPOSE 8080
CMD ["sh", "-c", "cd /app/backend && npx prisma db push --skip-generate && (npm run seed || true) && (node dist/index.js &) && nginx -g 'daemon off;'"]
