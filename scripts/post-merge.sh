#!/bin/bash
# Runs on Replit after a merge (.replit [postMerge]).
set -e
pnpm install --frozen-lockfile
# The DB is optional until ADR-04 is decided (P0-014); only push the schema when a database is configured.
if [ -n "${DATABASE_URL:-}" ]; then
  pnpm --filter @workspace/db push
else
  echo "post-merge: DATABASE_URL not set, skipping drizzle push"
fi
