FROM node:22-bookworm-slim AS base

RUN npm install --global npm@11.6.2

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl \
    && curl --fail --silent --show-error --retry 3 \
        https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
        --output /etc/ssl/certs/aws-rds-global-bundle.pem \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/aws-rds-global-bundle.pem

WORKDIR /app

FROM base AS builder

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json

RUN npm ci --no-audit --no-fund

COPY . .

# Prisma needs a syntactically valid URL while generating its client, but the
# build never connects to this placeholder. ECS supplies the real secret.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    npx turbo run build --filter=api

FROM base AS runner

ENV NODE_ENV=production

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json

RUN npm ci --omit=dev \
    --workspace=api \
    --workspace=@repo/contracts \
    --workspace=@repo/db \
    --include-workspace-root \
    --no-audit \
    --no-fund

COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/packages/contracts/dist packages/contracts/dist
COPY --from=builder /app/packages/database/dist packages/database/dist
COPY packages/database/prisma packages/database/prisma
COPY packages/database/prisma.config.ts packages/database/prisma.config.ts
COPY scripts/start-api.sh scripts/start-api.sh

RUN mkdir -p apps/api/uploads/profile-pictures apps/api/uploads/project-media \
    && chmod +x scripts/start-api.sh

EXPOSE 3001

CMD ["sh", "scripts/start-api.sh"]
