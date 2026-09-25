#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

if [ ! -f "$DATA_DIR/athlete_profile.json" ] && [ -f /app/data/athlete_profile.json ]; then
  cp /app/data/athlete_profile.json "$DATA_DIR/athlete_profile.json"
fi

if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="file:${DATA_DIR}/turnova.db"
fi

cd /app

run_migrate() {
  if [ -f ./node_modules/prisma/build/index.js ]; then
    node ./node_modules/prisma/build/index.js migrate deploy
  else
    npx prisma migrate deploy
  fi
}

if ! migrate_out=$(run_migrate 2>&1); then
  printf '%s\n' "$migrate_out"
  case "$migrate_out" in
    *malformed*)
      echo "Removing malformed SQLite database and retrying migrate"
      rm -f "${DATA_DIR}/turnova.db" "${DATA_DIR}/turnova.db-wal" "${DATA_DIR}/turnova.db-shm"
      run_migrate
      ;;
    *)
      exit 1
      ;;
  esac
else
  printf '%s\n' "$migrate_out"
fi
exec node server.js
