# Turnova

Context-aware web coaching app for experienced runners. Injects athlete profile, Norwegian Method doctrine, Strava training history, health telemetry, and a persisted weekly training plan into every Gemini chat turn.

## Stack

- Next.js (App Router) + Tailwind
- Vercel AI SDK + Google Gemini
- Prisma + SQLite (local-first privacy)
- Strava OAuth (Phase 6a)

## Setup

```bash
# Install
npm install

# Environment
cp .env.example .env.local
# Set GOOGLE_GENERATIVE_AI_API_KEY (no quotes)
# Set STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET (see Strava section)
# DATABASE_URL=file:./dev.db

# Optional: verify Gemini auth + stream
npm run test:gemini

# Database
npx prisma migrate dev
npm run db:seed

# Dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Strava (Phase 6a)

1. Create an API application at [Strava API settings](https://www.strava.com/settings/api).
2. Set **Authorization Callback Domain** to `localhost`.
3. Put credentials in `.env.local`:

```bash
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
STRAVA_REDIRECT_URI=http://localhost:3000/api/strava/callback
```

4. Restart `npm run dev`.
5. Click **Connect Strava** → authorize (pulls a small first chunk).
6. Click **Auto-backfill** to finish full history while respecting rate limits, **or** leave a terminal running:

```bash
npm run strava:backfill
```

Auto-backfill reads Strava `X-RateLimit-*` / `X-ReadRateLimit-*` headers, stops with headroom before the 15-minute and daily ceilings, waits for the next window (UTC :00/:15/:30/:45 or midnight UTC), then continues until complete.

### Rate limit env (Standard Tier defaults)

```bash
STRAVA_READ_LIMIT_15M=200
STRAVA_READ_LIMIT_DAILY=2000
STRAVA_OVERALL_LIMIT_15M=400
STRAVA_OVERALL_LIMIT_DAILY=4000
STRAVA_RATE_HEADROOM=15
```

If your API dashboard still shows the older/default read caps (100 / 15m, 1,000 / day), lower those env values so the client pauses earlier. The UI shows live read quota usage.

Stored locally: full activity list (types, workouts/races, HR, cadence, elevation, gear), gear catalog + usage rollups. Chat receives dense rollups (not raw GPS dumps).

### Profile & doctrine (files)

- PRs / athlete context: **Athlete profile** button in the chat header (writes [`data/athlete_profile.json`](data/athlete_profile.json))
- Coaching philosophy: edit [`data/coaching_doctrine.md`](data/coaching_doctrine.md) (in-app doctrine editor deferred)
- `GET` / `PUT` `/api/profile` for load/save

### Weekly plan

The week strip above chat is the canonical plan (Monday–Sunday, America/New_York). **Plan this week**, **Regenerate**, and chat **Update this week** write a structured 7-day object to SQLite (recent chat is extra instruction when present). Day cards overlay Strava actuals (planned vs ran). Chat talks about that stored week; it does not persist one-day patches.

- `GET /api/plan?weekStart=YYYY-MM-DD` — current week by default, including overlay
- `POST /api/plan/generate` — `{ "weekStart": "YYYY-MM-DD", "chatGuidance": "..." }` optional; upserts that Monday-start week

## Privacy (NFR-003)

Health metrics and Strava tokens/history live in SQLite (`prisma/dev.db` locally, `/data/turnova.db` on Fly). Do not commit `.env*` or `*.db` files.

## Production (Fly.io)

Always-on HTTPS for phone + desktop. SQLite and the athlete profile persist on a Fly volume. Password cookie gate. Add to Home Screen (Safari → Share → Add to Home Screen).

### One-time setup

1. Install [flyctl](https://fly.io/docs/flyctl/install/) and `fly auth login`.
2. From this directory:

```bash
fly launch --copy-config --no-deploy
fly volumes create turnova_data --region ewr --size 1
```

If `fly launch` picks a different app name, it will rewrite `app =` in `fly.toml`.

3. Set secrets (never commit these):

```bash
fly secrets set \
  GOOGLE_GENERATIVE_AI_API_KEY="..." \
  STRAVA_CLIENT_ID="..." \
  STRAVA_CLIENT_SECRET="..." \
  STRAVA_REDIRECT_URI="https://turnova.fly.dev/api/strava/callback" \
  APP_PASSWORD="..." \
  AUTH_SECRET="..." \
  DATABASE_URL="file:/data/turnova.db" \
  DATA_DIR="/data" \
  STRAVA_READ_LIMIT_15M=200 \
  STRAVA_READ_LIMIT_DAILY=2000
```

4. Deploy:

```bash
fly deploy
```

5. Copy your local database (Strava history + week plans) onto the volume:

```bash
# Machine must be running
fly sftp shell
# in the sftp prompt:
put prisma/dev.db /data/turnova.db
```

If WAL files exist (`prisma/dev.db-wal`, `prisma/dev.db-shm`), put those next to `/data/turnova.db` as `turnova.db-wal` / `turnova.db-shm`, or checkpoint SQLite first:

```bash
sqlite3 prisma/dev.db "PRAGMA wal_checkpoint(FULL);"
fly sftp shell
# put prisma/dev.db /data/turnova.db
```

Restart after the copy: `fly apps restart`.

6. Strava API app: set **Authorization Callback Domain** to `turnova.fly.dev` (hostname only, no `https://`). Keep `localhost` for local `.env.local`.

7. Open `https://turnova.fly.dev`, sign in, Connect Strava if tokens were not in the copied DB.

### Phone

Safari → Share → **Add to Home Screen**. The app runs standalone; Gemini still needs network.

Local `npm run dev` is unchanged: leave `APP_PASSWORD` unset to skip the login gate.

### Switching to Vercel later

Keep using [`lib/db.ts`](lib/db.ts) and [`lib/athlete-profile.ts`](lib/athlete-profile.ts) as the only disk access. A later Vercel move is a database + profile-store swap, not a rewrite.

## API

| Route | Purpose |
|-------|---------|
| `POST /api/login` | Password gate (sets session cookie) |
| `POST /api/logout` | Clear session cookie |
| `GET /api/auth/status` | Whether the password gate is enabled |
| `GET /api/context` | Injected doctrine + profile + Strava + telemetry + weekly plan (drawer) |
| `GET /api/plan` | Current (or `?weekStart=`) weekly plan + Strava overlay |
| `POST /api/plan/generate` | Generate/regenerate structured week via Gemini |
| `GET /api/profile` | Load athlete profile JSON |
| `PUT /api/profile` | Save athlete profile JSON |
| `GET /api/telemetry` | List daily telemetry rows |
| `POST /api/telemetry` | Upsert a daily snapshot |
| `GET /api/strava/connect` | Start Strava OAuth |
| `GET /api/strava/callback` | OAuth callback + first sync |
| `GET /api/strava/sync` | Connection / sync status |
| `POST /api/strava/sync` | Run backfill or incremental sync |

## Context layers (FR-003)

1. Persona + [`data/coaching_doctrine.md`](data/coaching_doctrine.md)
2. [`data/athlete_profile.json`](data/athlete_profile.json)
3. Strava training rollups (when connected)
4. All `daily_telemetry` rows (HealthSync Phase 6b later)
5. Persisted weekly plan (canonical this week + prior week)

## Smoke test

1. **Plan this week** — seven day cards, intent/weeks-out, Strava overlay on past days.
2. **Injected context** — doctrine, profile, Strava (if connected), seed telemetry, stored week.
3. Ask about Thursday / this week — expect the coach to refer to the stored plan, not invent a new grid.

## Spec

See [Spec.md](Spec.md) for full product requirements.
