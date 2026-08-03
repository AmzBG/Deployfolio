#!/bin/sh
set -eu

if [ "${RUN_DATABASE_MIGRATIONS:-false}" = "true" ]; then
  echo "Applying database migrations"
  npm run db:deploy --workspace=@repo/db
fi

exec npm run start:prod --workspace=api
