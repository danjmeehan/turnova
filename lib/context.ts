/**
 * FR-003 system context assembly:
 * 1. Base persona + Norwegian doctrine (FR-006)
 * 2. Athlete profile
 * 3. Strava training history (Phase 6a)
 * 4. Garmin gear locker
 * 5. Available daily telemetry (no fixed day window)
 * 6. Local weather (WeatherAPI current + forecast)
 * 7. Persisted weekly plan (canonical this week + prior week)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadAthleteProfile,
  primaryGoalRace,
  profileForPrompt,
  type AthleteProfile,
} from "@/lib/athlete-profile";
import {
  COACHING_DOCTRINE_LABEL,
  getCoachPersona,
} from "./coach-persona";
import {
  buildStravaContextPayload,
  type StravaContextPayload,
} from "@/lib/strava/context";
import { addDays } from "@/lib/week";
import {
  compactDayViewsForPrompt,
  compactPlanForPrompt,
  getWeeklyPlanView,
  lastRecoveryTelemetryDate,
  type WeeklyPlanView,
} from "@/lib/weekly-plan";
import { getWeatherContext, weatherPromptSection } from "@/lib/weather";
import { listGarminGear, type GarminGearRecord } from "@/lib/garmin/gear";

export { loadAthleteProfile } from "@/lib/athlete-profile";
export type { AthleteProfile } from "@/lib/athlete-profile";

export type DailyTelemetryRecord = {
  date: string;
  overnight_hrv?: number | null;
  sleep_score?: number | null;
  sleep_hours?: number | null;
  resting_hr?: number | null;
  stress?: number | null;
  source?: string | null;
  weekly_mileage?: number | null;
  last_run_summary?: {
    distance?: number | null;
    pace?: string | null;
    cardiac_drift_pct?: number | null;
  } | null;
};

export type InjectedContextMeta = {
  doctrineLabel: typeof COACHING_DOCTRINE_LABEL;
  telemetryCount: number;
  stravaConnected: boolean;
  stravaActivityCount: number;
  weeklyPlanWeekStart: string | null;
  weeklyPlanIntent: string | null;
  profileSummary: {
    name?: string;
    age?: number;
    race_target?: string;
    training_philosophy?: string;
    goal_race?: {
      name?: string;
      date?: string;
      distance?: string;
      goal_time?: string;
      status?: string;
    };
  };
};

function dataPath(...parts: string[]): string {
  return join(process.cwd(), "data", ...parts);
}

export function loadCoachingDoctrine(): string {
  return readFileSync(dataPath("coaching_doctrine.md"), "utf8");
}

export function loadAthleteProfileText(): string {
  return JSON.stringify(loadAthleteProfile(), null, 2);
}

function profileSummary(
  profile: AthleteProfile,
): InjectedContextMeta["profileSummary"] {
  const primary = primaryGoalRace(profile);
  return {
    name: profile.name,
    age: profile.age,
    race_target: profile.race_target.join(", ") || undefined,
    training_philosophy: profile.training_philosophy,
    goal_race: {
      name: primary.name || undefined,
      date: primary.date || undefined,
      distance: primary.distance || undefined,
      goal_time: primary.goal_time || undefined,
      status: primary.status || undefined,
    },
  };
}

function weeklyPlanSection(
  current: WeeklyPlanView,
  prior: WeeklyPlanView,
  recoveryEnd: string | null,
): string {
  if (!current.plan) {
    return [
      "(No persisted weekly plan — the week strip Plan this week button creates one.)",
      recoveryEnd
        ? `Recovery telemetry (HRV/sleep hours/sleep score/RHR/stress) ends ${recoveryEnd}; do not invent freshness after that.`
        : null,
      "This week's calendar + Strava actuals:",
      JSON.stringify(
        {
          weekStart: current.weekStart,
          days: compactDayViewsForPrompt(current.days),
        },
        null,
        2,
      ),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(
    {
      note: "This stored plan is canonical for the week. Chat does not patch individual days — tell the athlete to tap Update this week if they want the strip to match this conversation. Day status/actuals are from Strava (NY local date).",
      recoveryTelemetryEnds: recoveryEnd,
      current: {
        plan: compactPlanForPrompt(current.plan),
        days: compactDayViewsForPrompt(current.days),
      },
      priorWeek: prior.plan
        ? {
            plan: compactPlanForPrompt(prior.plan),
            days: compactDayViewsForPrompt(prior.days),
          }
        : null,
    },
    null,
    2,
  );
}

function garminGearSection(gear: GarminGearRecord[]): string {
  if (gear.length === 0) {
    return "(No Garmin gear locker rows yet. Sync Garmin after connecting.)";
  }
  return JSON.stringify(
    {
      items: gear,
      note: "garminGear is the active Connect locker (what Dan currently owns, Garmin miles, overlay role/notes). Retired gear is omitted. Strava recentActivities[].gearName is what was worn on a run when tagged. Do not invent a shoe on an untagged Strava activity.",
    },
    null,
    2,
  );
}

function stravaSection(strava: StravaContextPayload): string {
  if (!strava.connected) {
    return "(Strava not connected — training history unavailable.)";
  }
  return JSON.stringify(
    {
      sync: strava.sync,
      summary: strava.summary,
      gearUsage: strava.gearUsage,
      races: strava.races,
      recentActivities: strava.recentActivities,
      olderHistorySample: strava.olderHistorySample,
      note: "races is the COMPLETE list of Strava activities marked as races (newest first) — use it for any race inventory question. recentActivities is only the newest window (with mileSplits/laps when hasDetail=true). olderHistorySample is a sparse sample of older non-prioritized activities. Do not invent races or splits missing from these arrays.",
    },
    null,
    2,
  );
}

async function loadWeeklyPlanViews(): Promise<{
  current: WeeklyPlanView;
  prior: WeeklyPlanView;
}> {
  const current = await getWeeklyPlanView();
  const prior = await getWeeklyPlanView(addDays(current.weekStart, -7));
  return { current, prior };
}

export type AssembleSystemPromptOptions = {
  /** Soft-fail note when a quiet Garmin refresh did not complete. */
  garminNote?: string | null;
};

/**
 * Build the system prompt silently prepended before chat generation.
 */
export async function assembleSystemPrompt(
  telemetry: DailyTelemetryRecord[] = [],
  options: AssembleSystemPromptOptions = {},
): Promise<{ systemPrompt: string; meta: InjectedContextMeta }> {
  const persona = getCoachPersona();
  const doctrine = loadCoachingDoctrine();
  const profile = loadAthleteProfile();
  const profileText = JSON.stringify(profileForPrompt(profile), null, 2);
  const strava = await buildStravaContextPayload();
  const garminGear = await listGarminGear();
  const { current, prior } = await loadWeeklyPlanViews();
  const recoveryEnd = lastRecoveryTelemetryDate(telemetry);
  const telemetryText = [
    telemetry.length === 0
      ? "(No daily_telemetry records available yet.)"
      : JSON.stringify(telemetry, null, 2),
    options.garminNote ? `(Note: ${options.garminNote})` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const weather = await getWeatherContext(profile.location);

  const systemPrompt = [
    "## Coaching Persona",
    persona.trim(),
    "",
    "## Coaching Doctrine",
    doctrine.trim(),
    "",
    "## Athlete Profile",
    profileText,
    "",
    "## Garmin gear locker",
    garminGearSection(garminGear),
    "",
    "## Strava Training History (Phase 6a)",
    stravaSection(strava),
    "",
    "## Daily Telemetry (all available records)",
    telemetryText,
    "",
    "## Local weather",
    weatherPromptSection(weather),
    "",
    "## Current weekly plan (canonical)",
    weeklyPlanSection(current, prior, recoveryEnd),
  ].join("\n");

  return {
    systemPrompt,
    meta: {
      doctrineLabel: COACHING_DOCTRINE_LABEL,
      telemetryCount: telemetry.length,
      stravaConnected: strava.connected,
      stravaActivityCount: strava.summary?.activityCount ?? 0,
      weeklyPlanWeekStart: current.plan?.weekStart ?? current.weekStart,
      weeklyPlanIntent: current.plan?.intent ?? null,
      profileSummary: profileSummary(profile),
    },
  };
}

/**
 * Payload for the context drawer (FR-004) — same sources chat injects.
 */
export async function getInjectedContextPreview(
  telemetry: DailyTelemetryRecord[] = [],
): Promise<{
  doctrineLabel: typeof COACHING_DOCTRINE_LABEL;
  profile: AthleteProfile;
  profileSummary: InjectedContextMeta["profileSummary"];
  telemetry: DailyTelemetryRecord[];
  telemetryCount: number;
  strava: StravaContextPayload;
  garminGear: GarminGearRecord[];
  weeklyPlan: {
    current: WeeklyPlanView;
    prior: WeeklyPlanView | null;
    recoveryTelemetryEnds: string | null;
  };
}> {
  const profile = loadAthleteProfile();
  const strava = await buildStravaContextPayload();
  const garminGear = await listGarminGear();
  const { current, prior } = await loadWeeklyPlanViews();
  return {
    doctrineLabel: COACHING_DOCTRINE_LABEL,
    profile: profileForPrompt(profile),
    profileSummary: profileSummary(profile),
    telemetry,
    telemetryCount: telemetry.length,
    strava,
    garminGear,
    weeklyPlan: {
      current,
      prior: prior.plan ? prior : null,
      recoveryTelemetryEnds: lastRecoveryTelemetryDate(telemetry),
    },
  };
}
