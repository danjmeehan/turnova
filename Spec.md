# Product Specification: Context-Aware Agentic Running Coach (Web MVP)

## 1. Overview & Vision

A web-first, conversational AI coaching app for experienced runners. Unlike standard LLM chats, this application automatically injects the athlete's pre-existing running profile (historical background, PRs) and available training and health telemetry into every prompt context, delivering tailored, elite-level running advice without manual copy-pasting.

Coaching advice MUST follow Marius Bakken’s Norwegian threshold framework, with Chapter 5 of *The Norwegian Method Applied* as the primary operational source of principles (implemented as an original team-authored distillation—not reproduced book text). The coach does not default to generic mixed-method or polarized-slogans advice.

## 2. Target User Persona

- **Name/Profile:** Dan (46yo), former competitive collegiate runner.

- **Goals:** Half-marathon training, building a sustainable aerobic base while respecting recovery constraints.

- **Training Philosophy Preference:** Norwegian / double-threshold style base with controlled threshold sessions for half-marathon preparation.

- **Tone Preference:** Direct, running-oriented, highly analytical, non-cheerleader, zero generic "couch-to-5k" advice. Conversational plain text (not Markdown documents).

## 3. Core Functional Requirements (FR)

### FR-001: Static Athlete Profile Context

- The system MUST load a local configuration file `data/athlete_profile.json` into the LLM system prompt. In production, a `DATA_DIR` volume path MAY hold the writable copy (`$DATA_DIR/athlete_profile.json`); the git file remains the seed.

- This file is the canonical store for athlete identity and non-Strava personal context: collegiate/background history, age, race targets, **next goal race** (date/distance/time/notes for coach–athlete collaboration), goals, **historical PRs**, **shoe/gear inventory** (manual when Strava gear is empty), athlete-specific zone anchors (easy / LT1 / LT2 / VO2), device notes, and a philosophy preference flag (e.g. `"training_philosophy": "norwegian_threshold"`).

- The profile MUST NOT duplicate full coaching doctrine text; doctrine lives in FR-006.

- **Storage decision (locked):** Profile and PRs remain versioned files (not database rows) for the current phase.

- The app MUST provide an in-app UI to view and edit the athlete profile; saves write back to `data/athlete_profile.json`.

### FR-002: Health & Telemetry Data Ingestion

- The system MUST store daily health snapshots in a lightweight database schema `daily_telemetry`.

- Fields required: `date`, `overnight_hrv`, `sleep_score`, `resting_hr`, `weekly_mileage`, `last_run_summary` (distance, pace, cardiac drift % if available).

- For the local MVP, ingestion may be mocked via seed file or populated via a simple REST endpoint / cron script.

- Telemetry records are neutral evidence; the model interprets them through FR-006 doctrine. Schema MUST NOT embed training philosophy.

- **Phase note:** Rich Garmin/HealthSync population of this table is **Phase 6b** (see FR-005). Seed/manual API remain valid until then.

### FR-003: Dynamic System Context Assembly

- When a user submits a chat message, the backend MUST aggregate in this order:

  1. Base Coaching Persona instructions + Norwegian coaching doctrine (FR-006).

  2. The `athlete_profile.json` (identity, PRs, zones, goals).

  3. Available Strava training history summaries / rollups (FR-005 Phase 6a), when present.

  4. Available `daily_telemetry` records (no fixed day-window limit; Phase 6b enriches these).

  5. The persisted weekly training plan for the current Monday-start week (and prior week if stored), including Strava planned-vs-ran day status when available.

- Full raw Strava GPS streams MUST NOT be dumped wholesale into every prompt; store full detail in the database and inject dense rollups plus relevant session detail.

- This payload MUST be silently prepended to the LLM context wrapper before generating a response.

### FR-004: Browser-Based Streaming Chat Interface

- A clean web UI allowing continuous conversation.

- Streaming responses (token-by-token) via Server-Sent Events (SSE) or WebSockets.

- Display toggle or drawer showing "Current Injected Health Context" so the user can verify what data the LLM sees.

- The drawer SHOULD surface a short provenance label for active coaching doctrine (e.g. "Norwegian Method (Ch. 5 principles)")—label only, not full book text.

### FR-005: Data Provenance & Ingestion Channels

Two distinct channels, implemented in separate phases. Do not couple Strava training sync to HealthSync recovery sync.

#### Phase 6a — Workout telemetry (Strava) — **next**

- The system MUST ingest **full Strava activity history** for the connected athlete (one-time backfill + ongoing incremental sync).

- Persist rich activity detail in SQLite (Prisma), including at minimum:

  - Activity sport/type (e.g. Run, Trail Run, Virtual/treadmill Run, Swim, Ride, Workout, and other Strava types).

  - Workout vs race vs normal activity signals (`workout_type`, race flags, name/description as available).

  - Distance, moving/elapsed time, elevation, average/max HR, cadence, pace, and splits when available from the API.

  - Gear association per activity and gear metadata; track cumulative usage (distance/time) per piece of gear.

- OAuth tokens and sync cursors stored locally. Secrets only in env (client id/secret).

- Optional detail streams (HR/cadence/altitude) may be stored for deep analysis later; chat injection uses summaries/rollups first.

#### Phase 6b — Health & recovery (Garmin via HealthSync) — **later**

- Overnight HRV (RMSSD in ms), resting HR, and sleep scores → `daily_telemetry` (and related fields).

- Device context: Optical wrist-based tracking from Garmin watch (optical wrist HR during runs is susceptible to cadence lock; prioritize workout pace/RPE over isolated max HR spikes). Already reflected in doctrine/profile notes.

### FR-007: Persisted Weekly Training Plan

- The system MUST store one canonical training week per Monday-start week (`WeeklyPlan` in SQLite). Weeks are civil dates in America/New_York.

- Each week has `intent` (build / recover / race_week / taper / deload), optional `weeksOut` vs `goal_race`, a short `rationale`, and exactly seven day objects (`kind`, title, miles/duration, intensity, notes).

- The athlete MUST be able to generate or regenerate the current week from the UI (`Plan this week` / `Regenerate`) via structured LLM output. Invalid 7-day payloads MUST NOT be stored.

- The UI MUST render a week strip (not chat prose) and overlay Strava actuals by NY-local activity date with a light status (`upcoming`, `rest_ok`, `done`, `extra`, `missed`, `partial`).

- Chat MUST inject the stored plan as canonical and MUST NOT treat a prose week as the durable plan. Chat does not patch individual days. **Update this week** (and **Regenerate** when recent chat is sent) writes a new full 7-day stored week, using the conversation as extra instructions.

- Overnight HRV / sleep / RHR remain Phase 6b. Generation MUST NOT invent recovery metrics after the last telemetry row that has those fields.

### FR-006: Coaching Doctrine (Norwegian Method)

- The system MUST load a static doctrine file (`data/coaching_doctrine.md`) into the system prompt as part of base coaching persona (FR-003 layer 1).

- Source of principles: Marius Bakken, *The Norwegian Method Applied*, Chapter 5—implemented as an original distillation of operational principles, not a reproduction of copyrighted chapter text.

- Doctrine owns: intensity control, true easy vs threshold vs harder work, threshold session structure and progression, weekly architecture (including double-threshold concepts), recovery/readiness interpretation of telemetry, and explicit non-goals (contradictory polarization slogans, beginner templates, cheerleading).

- Doctrine MUST remain versionable independently of athlete profile, UI, Strava schema, and telemetry schema.

- **Storage decision (locked):** Coaching philosophy remains a versioned markdown file (not database rows) for the current phase.

- **Deferred:** In-app UI to view/edit doctrine (later version). Until then, edit `coaching_doctrine.md` directly.

## 4. Technical Architecture & Stack

- **Framework:** Next.js 14+ (App Router)

- **AI Integration:** Vercel AI SDK (`ai` / `@ai-sdk/react`) calling Gemini API via `@ai-sdk/google` (`GOOGLE_GENERATIVE_AI_API_KEY`).

- **Database:** SQLite via Prisma (local-first). Holds `daily_telemetry`, Strava activities/gear/tokens/cursors. Does **not** hold profile or doctrine bodies.

- **Styling:** Tailwind CSS (light, utilitarian chat UI; conversational plain-text coach replies).

- **Context payload sources:**

  - `lib/coach-persona.ts` — tone, safety, response style

  - `data/coaching_doctrine.md` — Norwegian Method operational principles (file)

  - `data/athlete_profile.json` — athlete identity, PRs, zones, philosophy flag (file)

  - Strava store (Phase 6a) — training history + gear usage rollups

  - Telemetry store — daily health evidence (seed now; HealthSync in 6b)

  - Weekly plan store — persisted Monday-start week + Strava overlay

  - `lib/context.ts` — assembles system prompt in FR-003 order

## 5. Non-Functional Requirements (NFR)

- **NFR-001:** Initial page load under 1.5 seconds.

- **NFR-002:** Chat stream response latency < 800ms to first token.

- **NFR-003:** Data privacy: Health metrics and Strava tokens/history stored locally (SQLite / local files) or on a private hosted instance (Fly.io volume). Not a public multi-tenant service.

## 6. Implementation status (checkpoint)

| Area | Status |
|------|--------|
| Spec, doctrine, profile files, context assembly | Done |
| Local MVP chat + seed telemetry + Gemini | Done |
| UI light theme + conversational (non-Markdown) replies | Done |
| Phase 6a Strava full history + gear | Done |
| Persisted weekly plan + Strava overlay (FR-007) | Done |
| Phase 6b HealthSync → `daily_telemetry` | Later |
| UI to view/edit athlete profile | Done |
| Private Fly.io deploy + password gate + PWA | Done |
| UI to view/edit doctrine | Deferred |
