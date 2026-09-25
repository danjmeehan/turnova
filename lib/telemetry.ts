import type { DailyTelemetry, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DailyTelemetryRecord } from "@/lib/context";

export type LastRunSummary = {
  distance?: number | null;
  pace?: string | null;
  cardiac_drift_pct?: number | null;
};

function toDateOnly(date: Date | string): Date {
  if (typeof date === "string") {
    return new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  }
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseLastRunSummary(value: unknown): LastRunSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return {
    distance: typeof v.distance === "number" ? v.distance : null,
    pace: typeof v.pace === "string" ? v.pace : null,
    cardiac_drift_pct:
      typeof v.cardiac_drift_pct === "number"
        ? v.cardiac_drift_pct
        : typeof v.cardiacDriftPct === "number"
          ? v.cardiacDriftPct
          : null,
  };
}

export function mapTelemetryRow(row: DailyTelemetry): DailyTelemetryRecord {
  return {
    date: formatDateKey(row.date),
    overnight_hrv: row.overnightHrv,
    sleep_score: row.sleepScore,
    sleep_hours: row.sleepHours,
    resting_hr: row.restingHr,
    stress: row.stress,
    source: row.source,
    weekly_mileage: row.weeklyMileage,
    last_run_summary: parseLastRunSummary(row.lastRunSummary),
  };
}

/** All telemetry rows ascending by date — no day-window cap (FR-003). */
export async function getAllTelemetry(): Promise<DailyTelemetryRecord[]> {
  const rows = await prisma.dailyTelemetry.findMany({
    orderBy: { date: "asc" },
  });
  return rows.map(mapTelemetryRow);
}

export type UpsertTelemetryInput = {
  date: string;
  overnight_hrv?: number | null;
  sleep_score?: number | null;
  sleep_hours?: number | null;
  resting_hr?: number | null;
  stress?: number | null;
  source?: string;
  weekly_mileage?: number | null;
  last_run_summary?: LastRunSummary | null;
};

export async function upsertTelemetry(
  input: UpsertTelemetryInput,
): Promise<DailyTelemetryRecord> {
  const date = toDateOnly(input.date);
  const lastRunSummary =
    input.last_run_summary === undefined || input.last_run_summary === null
      ? undefined
      : (input.last_run_summary as Prisma.InputJsonValue);

  const row = await prisma.dailyTelemetry.upsert({
    where: { date },
    create: {
      date,
      overnightHrv: input.overnight_hrv ?? null,
      sleepScore: input.sleep_score ?? null,
      sleepHours: input.sleep_hours ?? null,
      restingHr: input.resting_hr ?? null,
      stress: input.stress ?? null,
      source: input.source ?? "garmin",
      weeklyMileage: input.weekly_mileage ?? null,
      lastRunSummary,
    },
    update: {
      ...(input.overnight_hrv !== undefined
        ? { overnightHrv: input.overnight_hrv }
        : {}),
      ...(input.sleep_score !== undefined
        ? { sleepScore: input.sleep_score }
        : {}),
      ...(input.sleep_hours !== undefined
        ? { sleepHours: input.sleep_hours }
        : {}),
      ...(input.resting_hr !== undefined
        ? { restingHr: input.resting_hr }
        : {}),
      ...(input.stress !== undefined ? { stress: input.stress } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.weekly_mileage !== undefined
        ? { weeklyMileage: input.weekly_mileage }
        : {}),
      ...(input.last_run_summary !== undefined
        ? {
            lastRunSummary:
              input.last_run_summary === null
                ? undefined
                : (input.last_run_summary as Prisma.InputJsonValue),
          }
        : {}),
    },
  });

  return mapTelemetryRow(row);
}
