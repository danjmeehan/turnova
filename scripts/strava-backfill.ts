/**
 * Unattended Strava backfill respecting Standard Tier rate limits.
 *
 * Usage (with app connected via OAuth first):
 *   npm run strava:backfill
 *
 * Leaves the process running across 15-minute / daily windows until history is complete.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStoredStravaToken } from "../lib/strava/auth";
import { runStravaSyncChunk, setAutoBackfillEnabled } from "../lib/strava/sync";

function loadEnvFile(filePath: string, override: boolean) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), ".env"), false);
loadEnvFile(resolve(process.cwd(), ".env.local"), true);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const token = await getStoredStravaToken();
  if (!token) {
    console.error("Strava not connected. Open the app and click Connect Strava first.");
    process.exit(1);
  }

  await setAutoBackfillEnabled(true);
  console.log("Starting rate-limit-aware Strava backfill (Standard Tier defaults)…");
  console.log(
    `Limits: read ${process.env.STRAVA_READ_LIMIT_15M || 200}/15m, ${process.env.STRAVA_READ_LIMIT_DAILY || 2000}/day (headroom ${process.env.STRAVA_RATE_HEADROOM || 15})`,
  );

  let first = true;
  while (true) {
    const result = await runStravaSyncChunk({
      refreshGear: first,
      maxRequests: 40,
    });
    first = false;

    console.log(
      `[${new Date().toISOString()}] mode=${result.mode} +acts=${result.activitiesUpserted} +details=${result.detailsFetched} pages=${result.pagesFetched} req=${result.requestsUsed} total=${result.totalActivities} missingSplits=${result.recentMissingSplits} complete=${result.backfillComplete} paused=${result.paused}${result.pauseReason ? `(${result.pauseReason})` : ""}`,
    );

    if (result.rateLimit) {
      const r = result.rateLimit;
      console.log(
        `  rate read ${r.read15m}/${r.read15mLimit} (15m), ${r.readDaily}/${r.readDailyLimit} (day)`,
      );
    }

    if (result.backfillComplete && result.recentMissingSplits === 0) {
      await setAutoBackfillEnabled(false);
      console.log("OK — history + recent activity splits complete.");
      break;
    }

    if (result.paused && result.retryAt) {
      const waitMs = Math.max(2000, new Date(result.retryAt).getTime() - Date.now() + 2000);
      console.log(`  waiting until ${result.retryAt} (${Math.ceil(waitMs / 1000)}s)…`);
      await sleep(waitMs);
    } else {
      await sleep(1500);
    }
  }
}

main().catch(async (err) => {
  console.error("FAIL —", err instanceof Error ? err.message : err);
  await setAutoBackfillEnabled(false).catch(() => undefined);
  process.exit(1);
});
