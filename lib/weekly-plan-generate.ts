/**
 * Structured weekly-plan generation via Gemini generateObject.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { loadAthleteProfile, primaryGoalRace, profileForPrompt } from "@/lib/athlete-profile";
import { getCoachPersona } from "@/lib/coach-persona";
import { loadCoachingDoctrine } from "@/lib/context";
import { assertGoogleGenerativeAiApiKey } from "@/lib/env";
import { getAllTelemetry } from "@/lib/telemetry";
import {
  garminNoteFromQuiet,
  maybeQuietGarminSync,
} from "@/lib/garmin/sync";
import {
  currentMondayKey,
  mondayOfWeek,
  weekDateKeys,
  weekdayLabel,
  weeksOutFromRace,
} from "@/lib/week";
import {
  compactPlanForPrompt,
  getPlanByWeekStart,
  getPriorPlan,
  lastRecoveryTelemetryDate,
  recentStravaRollup,
  upsertWeeklyPlan,
  validateDaysMatchWeek,
  weeklyPlanGenerateSchema,
  type StoredWeeklyPlan,
} from "@/lib/weekly-plan";
import { getWeatherContext, weatherPromptSection } from "@/lib/weather";
import { listGarminGear } from "@/lib/garmin/gear";

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

export async function generateWeeklyPlan(
  weekStartInput?: string,
  options?: { chatGuidance?: string },
): Promise<StoredWeeklyPlan> {
  const weekStart = mondayOfWeek(weekStartInput ?? currentMondayKey());
  const dates = weekDateKeys(weekStart);
  const dayGuide = dates.map((date) => ({
    date,
    weekday: weekdayLabel(date),
  }));

  const profile = loadAthleteProfile();
  const primary = primaryGoalRace(profile);
  const weeksOut = weeksOutFromRace(weekStart, primary.date || null);
  const garminSync = await maybeQuietGarminSync();
  const [telemetry, strava, garminGear, existing, prior, weather] = await Promise.all([
    getAllTelemetry(),
    recentStravaRollup(14),
    listGarminGear(),
    getPlanByWeekStart(weekStart),
    getPriorPlan(weekStart),
    getWeatherContext(profile.location),
  ]);
  const recoveryEnd = lastRecoveryTelemetryDate(telemetry);
  const garminNote = garminNoteFromQuiet(garminSync);

  const apiKey = assertGoogleGenerativeAiApiKey();
  const google = createGoogleGenerativeAI({ apiKey });

  const system = [
    getCoachPersona().trim(),
    "",
    "## Coaching Doctrine",
    loadCoachingDoctrine().trim(),
    "",
    "You are generating a structured weekly training plan object, not a chat reply.",
    "Most volume is truly easy (below LT1). Quality is limited, controlled threshold (LT2), not gray-zone tempo.",
    "Double-threshold only when recent load and (if available) recovery support it.",
    "Do not invent overnight HRV, sleep score, sleep hours, resting HR, or stress after the recovery feed ends.",
    "Fill every day. Rest days are valid. Use athlete zone language (easy / LT1 / LT2 / VO2).",
    "strength is an optional same-day lift after the run on that date. kind, miles, and intensity stay the run. Set strength to null when not programming a lift, and always null on rest days.",
    "nutrition lists pantry items that fit that day. Use the exact pantry name. notes is one or two sentences on timing and why, not the full description. Use an empty array when none fit, and always on rest days. Do not invent supplements that are not in the pantry.",
    "Supporting strength 1–2 days/week is typical. Skip or keep very light on race week and double-threshold days. Do not invent gym equipment; keep notes generic unless the athlete profile names gear.",
    "Use the Local weather block for outdoor vs indoor placement, heat/ice caution, and rain swaps. Do not invent weather past the last forecast date.",
    "days MUST contain exactly these 7 dates in order, with matching weekday labels.",
  ].join("\n");

  const prompt = [
    `Target weekStart (Monday): ${weekStart}`,
    `Days (required): ${JSON.stringify(dayGuide)}`,
    weeksOut == null
      ? "weeksOut: unknown (no primary goal race date)"
      : `Computed weeksOut vs primary goal race week: ${weeksOut} (0 = race week).`,
    existing
      ? "This is a REGENERATE of an existing plan for this same week. Improve it; do not ignore what already ran if actuals are in the Strava rollup."
      : "No plan exists for this week yet.",
    "",
    options?.chatGuidance?.trim()
      ? [
          "## Recent chat (honor this)",
          "The athlete and coach just discussed this week. Honor that conversation when writing the seven days. Keep the rest of the week unless the chat requires a change. Do not invent Strava actuals or recovery metrics.",
          options.chatGuidance.trim(),
          "",
        ].join("\n")
      : "",
    "## Athlete profile",
    JSON.stringify(profileForPrompt(profile), null, 2),
    "",
    "## Garmin gear locker",
    garminGear.length === 0
      ? "(No Garmin gear locker rows yet.)"
      : JSON.stringify(garminGear, null, 2),
    "",
    "## Prior week plan (if any)",
    prior
      ? JSON.stringify(compactPlanForPrompt(prior), null, 2)
      : "(none stored)",
    "",
    "## Existing plan for this week (if regenerating)",
    existing
      ? JSON.stringify(compactPlanForPrompt(existing), null, 2)
      : "(none)",
    "",
    "## Strava last 14 days (actuals)",
    JSON.stringify(strava, null, 2),
    "",
    "## Daily telemetry",
    recoveryEnd
      ? `Overnight HRV / sleep score / sleep hours / resting HR / stress end on ${recoveryEnd}. Do not invent freshness after that date. Prefer source=garmin over seed. Use Strava load and athlete self-report for readiness.`
      : "No recovery telemetry rows with HRV/sleep/RHR/stress.",
    garminNote ? `(Note: ${garminNote})` : null,
    JSON.stringify(telemetry, null, 2),
    "",
    "## Local weather",
    weatherPromptSection(weather),
  ]
    .filter((line): line is string => line != null)
    .join("\n");

  const { object } = await generateObject({
    model: google("gemini-flash-latest"),
    schema: weeklyPlanGenerateSchema,
    schemaName: "WeeklyTrainingPlan",
    schemaDescription:
      "A Monday-start 7-day Norwegian-method training week for this athlete.",
    system,
    prompt,
  });

  const mismatch = validateDaysMatchWeek(object.days, weekStart);
  if (mismatch) {
    throw new PlanValidationError(mismatch);
  }

  const pantryNames = new Map(
    profile.pantry
      .filter((item) => item.name.trim())
      .map((item) => [item.name.trim().toLowerCase(), item.name.trim()]),
  );
  const days = object.days.map((day) => {
    const seen = new Set<string>();
    const nutrition = (day.nutrition ?? []).flatMap((item) => {
      const canonical = pantryNames.get(item.name.trim().toLowerCase());
      const notes = item.notes.trim();
      if (!canonical || !notes || seen.has(canonical)) return [];
      seen.add(canonical);
      return [{ name: canonical, notes }];
    });
    return { ...day, nutrition };
  });

  return upsertWeeklyPlan({
    weekStart,
    intent: object.intent,
    weeksOut,
    rationale: object.rationale,
    days,
  });
}
