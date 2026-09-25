import { NextRequest, NextResponse } from "next/server";
import { getRateLimitStatus, getStoredStravaToken } from "@/lib/strava/auth";
import {
  runStravaSyncChunk,
  setAutoBackfillEnabled,
} from "@/lib/strava/sync";
import { getStravaRateLimitConfig } from "@/lib/strava/rate-limit";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const token = await getStoredStravaToken();
    if (!token) {
      return NextResponse.json(
        { error: "Strava not connected. Use Connect Strava first." },
        { status: 401 },
      );
    }

    let body: {
      auto?: boolean;
      chunk?: boolean;
      refreshGear?: boolean;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }

    if (typeof body.auto === "boolean") {
      await setAutoBackfillEnabled(body.auto);
      if (!body.auto && !body.chunk) {
        return NextResponse.json({
          ok: true,
          autoBackfillEnabled: false,
          message: "Auto-backfill stopped",
        });
      }
    }

    const result = await runStravaSyncChunk({
      refreshGear: body.refreshGear === true,
      maxRequests: 40,
    });

    // Keep auto flag in sync with completion of history + recent splits
    if (
      result.backfillComplete &&
      result.recentMissingSplits === 0
    ) {
      await setAutoBackfillEnabled(false);
      result.autoBackfillEnabled = false;
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[strava/sync]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const token = await getStoredStravaToken();
  const sync = await prisma.stravaSyncState.findUnique({
    where: { id: "default" },
  });
  const activityCount = await prisma.stravaActivity.count();
  const gearCount = await prisma.stravaGear.count();
  const rate = await getRateLimitStatus();
  const limits = getStravaRateLimitConfig();
  const recentMissingSplits = (
    await prisma.stravaActivity.findMany({
      orderBy: { startDate: "desc" },
      take: 40,
      select: { detailFetchedAt: true },
    })
  ).filter((a) => !a.detailFetchedAt).length;

  return NextResponse.json({
    connected: Boolean(token),
    athleteId: token?.athleteId ?? null,
    activityCount,
    gearCount,
    configuredLimits: limits,
    rate,
    sync: sync
      ? {
          backfillComplete: sync.backfillComplete,
          backfillBeforeEpoch: sync.backfillBeforeEpoch,
          autoBackfillEnabled: sync.autoBackfillEnabled,
          lastSyncedAt: sync.lastSyncedAt,
          activitiesSynced: sync.activitiesSynced,
          lastError: sync.lastError,
          rateLimitedUntil: sync.rateLimitedUntil,
          recentMissingSplits,
        }
      : null,
  });
}
