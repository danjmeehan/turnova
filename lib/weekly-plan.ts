/**
 * Persisted weekly training plan + Strava planned-vs-ran overlay.
 */

import type { Prisma, WeeklyPlan } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { classifyActivityKind } from "@/lib/strava/types";
import {
  activityDateKey,
  addDays,
  currentMondayKey,
  formatDateKey,
  mondayOfWeek,
  toDateOnly,
  todayDateKey,
  weekDateKeys,
  weekdayLabel,
  WEEKDAYS,
  type Weekday,
} from "@/lib/week";

export const PLAN_INTENTS = [
  "build",
  "recover",
  "race_week",
  "taper",
  "deload",
] as const;

export const PLAN_KINDS = [
  "easy",
  "lt1",
  "lt2",
  "double_threshold",
  "long",
  "rest",
  "race",
  "other",
] as const;

export const DAY_STATUSES = [
  "upcoming",
  "rest_ok",
  "done",
  "extra",
  "missed",
  "partial",
] as const;

export type PlanIntent = (typeof PLAN_INTENTS)[number];
export type PlanKind = (typeof PLAN_KINDS)[number];
export type DayStatus = (typeof DAY_STATUSES)[number];

export const planDaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Civil date YYYY-MM-DD"),
  weekday: z.enum(WEEKDAYS),
  kind: z.enum(PLAN_KINDS),
  title: z.string().describe("Short session name, e.g. Easy 50 min"),
  durationMin: z
    .number()
    .nullable()
    .describe("Moving duration in minutes, or null for rest"),
  miles: z.number().nullable().describe("Distance in miles, or null"),
  intensity: z
    .string()
    .describe("One-line intensity cue, e.g. easy below LT1 or LT2 5x6 min"),
  sessionNotes: z
    .string()
    .describe("Brief how-to / purpose for this day"),
  strength: z
    .object({
      title: z.string().describe("Short lift name, e.g. Easy-day strength"),
      durationMin: z
        .number()
        .nullable()
        .describe("Lift duration in minutes, or null"),
      notes: z
        .string()
        .describe(
          "Exercises and how-to; keep generic unless the profile names equipment",
        ),
    })
    .nullable()
    .default(null)
    .describe(
      "Optional same-day lift after the run; null when not programming strength. Never a substitute for the run. Null on rest days.",
    ),
  nutrition: z
    .array(
      z.object({
        name: z.string().describe("Exact pantry item name"),
        notes: z
          .string()
          .describe(
            "One or two sentences on timing and why for this day, not the full pantry description",
          ),
      }),
    )
    .default([])
    .describe(
      "Pantry items that fit this day. Empty when none fit, including rest days. Never invent a product.",
    ),
});

export const weeklyPlanGenerateSchema = z.object({
  intent: z.enum(PLAN_INTENTS),
  rationale: z
    .string()
    .describe("One or two sentences on why this week is structured this way"),
  days: z.array(planDaySchema).length(7),
});

export type PlanDay = z.infer<typeof planDaySchema>;
export type GeneratedWeeklyPlan = z.infer<typeof weeklyPlanGenerateSchema>;

export type StoredWeeklyPlan = {
  id: string;
  weekStart: string;
  intent: PlanIntent;
  weeksOut: number | null;
  rationale: string | null;
  days: PlanDay[];
  generatedAt: string;
};

export type ActualActivity = {
  name: string;
  kindLabel: string;
  miles: number | null;
  pace: string | null;
  movingMin: number | null;
};

export type DayActual = {
  miles: number;
  movingMin: number;
  activities: ActualActivity[];
};

export type PlanDayView = {
  date: string;
  weekday: Weekday;
  prescribed: PlanDay | null;
  actual: DayActual;
  status: DayStatus;
};

export type WeeklyPlanView = {
  weekStart: string;
  plan: StoredWeeklyPlan | null;
  days: PlanDayView[];
};

function metersToMiles(m: number | null | undefined): number | null {
  if (m == null) return null;
  return Math.round((m / 1609.344) * 100) / 100;
}

function formatPace(
  distanceMeters?: number | null,
  movingSec?: number | null,
): string | null {
  if (!distanceMeters || !movingSec || distanceMeters <= 0) return null;
  const miles = distanceMeters / 1609.344;
  if (miles <= 0) return null;
  const secPerMile = movingSec / miles;
  const min = Math.floor(secPerMile / 60);
  const sec = Math.round(secPerMile % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/mi`;
}

function movingMinFromSec(sec: number | null | undefined): number | null {
  if (sec == null || sec < 0) return null;
  return Math.round(sec / 60);
}

export function validateDaysMatchWeek(
  days: PlanDay[],
  weekStartKey: string,
): string | null {
  const expected = weekDateKeys(weekStartKey);
  if (days.length !== 7) {
    return `Expected 7 days, got ${days.length}`;
  }
  for (let i = 0; i < 7; i++) {
    const day = days[i];
    if (day.date !== expected[i]) {
      return `Day ${i + 1} date ${day.date} does not match ${expected[i]}`;
    }
    if (day.weekday !== weekdayLabel(expected[i])) {
      return `Day ${i + 1} weekday ${day.weekday} does not match ${weekdayLabel(expected[i])}`;
    }
  }
  return null;
}

function parseDaysJson(value: unknown): PlanDay[] {
  const parsed = z.array(planDaySchema).safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid stored weekly plan days: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function mapPlanRow(row: WeeklyPlan): StoredWeeklyPlan {
  const intentParsed = z.enum(PLAN_INTENTS).safeParse(row.intent);
  return {
    id: row.id,
    weekStart: formatDateKey(row.weekStart),
    intent: intentParsed.success ? intentParsed.data : "build",
    weeksOut: row.weeksOut,
    rationale: row.rationale,
    days: parseDaysJson(row.days),
    generatedAt: row.generatedAt.toISOString(),
  };
}

export async function getPlanByWeekStart(
  weekStartKey: string,
): Promise<StoredWeeklyPlan | null> {
  const monday = mondayOfWeek(weekStartKey);
  const row = await prisma.weeklyPlan.findUnique({
    where: { weekStart: toDateOnly(monday) },
  });
  return row ? mapPlanRow(row) : null;
}

export async function getPriorPlan(
  weekStartKey: string,
): Promise<StoredWeeklyPlan | null> {
  return getPlanByWeekStart(addDays(mondayOfWeek(weekStartKey), -7));
}

export type UpsertWeeklyPlanInput = {
  weekStart: string;
  intent: PlanIntent;
  weeksOut: number | null;
  rationale: string | null;
  days: PlanDay[];
};

export async function upsertWeeklyPlan(
  input: UpsertWeeklyPlanInput,
): Promise<StoredWeeklyPlan> {
  const monday = mondayOfWeek(input.weekStart);
  const mismatch = validateDaysMatchWeek(input.days, monday);
  if (mismatch) {
    throw new Error(mismatch);
  }
  const weekStart = toDateOnly(monday);
  const now = new Date();
  const daysJson = input.days as Prisma.InputJsonValue;
  const row = await prisma.weeklyPlan.upsert({
    where: { weekStart },
    create: {
      weekStart,
      intent: input.intent,
      weeksOut: input.weeksOut,
      rationale: input.rationale,
      days: daysJson,
      generatedAt: now,
    },
    update: {
      intent: input.intent,
      weeksOut: input.weeksOut,
      rationale: input.rationale,
      days: daysJson,
      generatedAt: now,
    },
  });
  return mapPlanRow(row);
}

function emptyActual(): DayActual {
  return { miles: 0, movingMin: 0, activities: [] };
}

function scoreDay(
  date: string,
  prescribed: PlanDay | null,
  actual: DayActual,
  today: string,
): DayStatus {
  const isFuture = date > today;
  const hasActivity = actual.activities.length > 0;

  if (isFuture) return "upcoming";

  if (!prescribed) {
    return hasActivity ? "done" : "rest_ok";
  }

  if (prescribed.kind === "rest") {
    if (!hasActivity) return "rest_ok";
    return "extra";
  }

  if (!hasActivity) return date < today ? "missed" : "upcoming";

  const plannedMiles = prescribed.miles;
  if (plannedMiles == null || plannedMiles <= 0) {
    return "done";
  }
  const lo = plannedMiles * 0.75;
  const hi = plannedMiles * 1.25;
  if (actual.miles >= lo && actual.miles <= hi) return "done";
  return "partial";
}

async function activitiesByDate(
  fromKey: string,
  toKey: string,
): Promise<Map<string, DayActual>> {
  const from = toDateOnly(addDays(fromKey, -1));
  const to = toDateOnly(addDays(toKey, 2));
  const rows = await prisma.stravaActivity.findMany({
    where: {
      startDate: { gte: from, lt: to },
    },
    orderBy: { startDate: "asc" },
  });

  const map = new Map<string, DayActual>();
  for (const row of rows) {
    const key = activityDateKey(row.startDate, row.timezone);
    if (key < fromKey || key > toKey) continue;
    const { kindLabel } = classifyActivityKind({
      sportType: row.sportType,
      workoutType: row.workoutType,
      name: row.name,
    });
    const miles = metersToMiles(row.distanceMeters);
    const movingMin = movingMinFromSec(row.movingTimeSec);
    const entry = map.get(key) ?? emptyActual();
    entry.activities.push({
      name: row.name,
      kindLabel,
      miles,
      pace: formatPace(row.distanceMeters, row.movingTimeSec),
      movingMin,
    });
    entry.miles = Math.round((entry.miles + (miles ?? 0)) * 100) / 100;
    entry.movingMin += movingMin ?? 0;
    map.set(key, entry);
  }
  return map;
}

export async function getWeeklyPlanView(
  weekStartKey?: string,
): Promise<WeeklyPlanView> {
  const monday = mondayOfWeek(weekStartKey ?? currentMondayKey());
  const dates = weekDateKeys(monday);
  const today = todayDateKey();
  const [plan, actuals] = await Promise.all([
    getPlanByWeekStart(monday),
    activitiesByDate(dates[0], dates[6]),
  ]);
  const byDate = new Map((plan?.days ?? []).map((d) => [d.date, d]));

  const days: PlanDayView[] = dates.map((date) => {
    const prescribed = byDate.get(date) ?? null;
    const actual = actuals.get(date) ?? emptyActual();
    return {
      date,
      weekday: weekdayLabel(date),
      prescribed,
      actual,
      status: scoreDay(date, prescribed, actual, today),
    };
  });

  return { weekStart: monday, plan, days };
}

export async function getWeeklyPlanViews(
  startMondayKey?: string,
  count = 4,
): Promise<WeeklyPlanView[]> {
  const start = mondayOfWeek(startMondayKey ?? currentMondayKey());
  const n = Math.min(8, Math.max(1, Math.trunc(count)));
  const keys = Array.from({ length: n }, (_, i) => addDays(start, i * 7));
  return Promise.all(keys.map((key) => getWeeklyPlanView(key)));
}

export function compactPlanForPrompt(plan: StoredWeeklyPlan | null): unknown {
  if (!plan) return null;
  return {
    weekStart: plan.weekStart,
    intent: plan.intent,
    weeksOut: plan.weeksOut,
    rationale: plan.rationale,
    generatedAt: plan.generatedAt,
    days: plan.days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      kind: d.kind,
      title: d.title,
      durationMin: d.durationMin,
      miles: d.miles,
      intensity: d.intensity,
      sessionNotes: d.sessionNotes,
      strength: d.strength ?? null,
      nutrition: d.nutrition ?? [],
    })),
  };
}

export function compactDayViewsForPrompt(days: PlanDayView[]): unknown {
  return days.map((d) => ({
    date: d.date,
    weekday: d.weekday,
    status: d.status,
    prescribed: d.prescribed
      ? {
          kind: d.prescribed.kind,
          title: d.prescribed.title,
          miles: d.prescribed.miles,
          durationMin: d.prescribed.durationMin,
          intensity: d.prescribed.intensity,
          strength: d.prescribed.strength ?? null,
        }
      : null,
    actual:
      d.actual.activities.length > 0
        ? {
            miles: d.actual.miles,
            movingMin: d.actual.movingMin,
            activities: d.actual.activities.map((a) => ({
              name: a.name,
              kindLabel: a.kindLabel,
              miles: a.miles,
              pace: a.pace,
            })),
          }
        : null,
  }));
}

export async function recentStravaRollup(daysBack: number = 14): Promise<{
  from: string;
  to: string;
  activities: Array<{
    date: string;
    name: string;
    kindLabel: string;
    miles: number | null;
    pace: string | null;
    movingMin: number | null;
    isRace: boolean;
  }>;
  totals: { miles: number; activityCount: number; workoutLike: number };
}> {
  const to = todayDateKey();
  const from = addDays(to, -(daysBack - 1));
  const rows = await prisma.stravaActivity.findMany({
    where: {
      startDate: {
        gte: toDateOnly(addDays(from, -1)),
        lt: toDateOnly(addDays(to, 2)),
      },
    },
    orderBy: { startDate: "asc" },
  });

  const activities: Array<{
    date: string;
    name: string;
    kindLabel: string;
    miles: number | null;
    pace: string | null;
    movingMin: number | null;
    isRace: boolean;
  }> = [];

  let miles = 0;
  let workoutLike = 0;
  for (const row of rows) {
    const date = activityDateKey(row.startDate, row.timezone);
    if (date < from || date > to) continue;
    const { kindLabel, isRace } = classifyActivityKind({
      sportType: row.sportType,
      workoutType: row.workoutType,
      name: row.name,
    });
    const mi = metersToMiles(row.distanceMeters);
    activities.push({
      date,
      name: row.name,
      kindLabel,
      miles: mi,
      pace: formatPace(row.distanceMeters, row.movingTimeSec),
      movingMin: movingMinFromSec(row.movingTimeSec),
      isRace,
    });
    miles += mi ?? 0;
    if (row.workoutType === 3 || isRace || row.workoutType === 2) {
      workoutLike += 1;
    }
  }

  return {
    from,
    to,
    activities,
    totals: {
      miles: Math.round(miles * 10) / 10,
      activityCount: activities.length,
      workoutLike,
    },
  };
}

export function lastRecoveryTelemetryDate(
  rows: Array<{
    date: string;
    overnight_hrv?: number | null;
    sleep_score?: number | null;
    sleep_hours?: number | null;
    resting_hr?: number | null;
    stress?: number | null;
  }>,
): string | null {
  let last: string | null = null;
  for (const row of rows) {
    const has =
      row.overnight_hrv != null ||
      row.sleep_score != null ||
      row.sleep_hours != null ||
      row.resting_hr != null ||
      row.stress != null;
    if (has && (!last || row.date > last)) last = row.date;
  }
  return last;
}
