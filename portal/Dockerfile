FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN mkdir -p /var/compliance-build/.next /app/public

# The application deliberately uses production-only bootstrap guards. These
# values are build-time placeholders only; runtime values are injected by
# Compose from the remote .env file.
ENV NODE_ENV=production \
    APP_MODE=prod \
    DATABASE_URL=postgresql://asv_app:build-only@db:5432/asv_portal \
    ADMIN_DATABASE_URL=postgresql://asv:build-only@db:5432/asv_portal \
    MANIFEST_SECRET=build-only \
    KEYCLOAK_ISSUER=http://keycloak:8080/auth/realms/asv-portal \
    KEYCLOAK_CLIENT_ID=asv-portal \
    KEYCLOAK_CLIENT_SECRET=build-only \
    STAFF_ROLE=asv-staff

RUN npx prisma generate && npm run build

# Next currently resolves the repository's absolute distDir differently under
# Docker BuildKit on some hosts. Normalize whichever location it selected so
# the runner stage has one stable artifact path.
RUN set -eux; \
    if [ ! -d /var/compliance-build/.next/standalone ] && [ -d /app/var/compliance-build/.next/standalone ]; then \
      mkdir -p /var/compliance-build/.next; \
      cp -a /app/var/compliance-build/.next/. /var/compliance-build/.next/; \
    elif [ ! -d /var/compliance-build/.next/standalone ] && [ -d /app/.next/standalone ]; then \
      mkdir -p /var/compliance-build/.next; \
      cp -a /app/.next/. /var/compliance-build/.next/; \
    fi; \
    if [ ! -f /var/compliance-build/.next/standalone/server.js ]; then \
      echo "standalone artifact not found; discovered candidates:"; \
      find /app /var -maxdepth 8 -type f -name server.js -print; \
      find /app /var -maxdepth 8 -type d -name .next -print; \
      exit 1; \
    fi; \
    test -d /var/compliance-build/.next/static

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000

COPY --from=builder /var/compliance-build/.next/standalone ./
COPY --from=builder /var/compliance-build/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000

CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]
