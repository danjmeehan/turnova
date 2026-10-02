import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { loadAthleteProfile } from "@/lib/athlete-profile";
import { assembleSystemPrompt } from "@/lib/context";
import { assertGoogleGenerativeAiApiKey } from "@/lib/env";
import {
  garminNoteFromQuiet,
  maybeQuietGarminSync,
} from "@/lib/garmin/sync";
import { getAllTelemetry } from "@/lib/telemetry";
import { getWeatherContext } from "@/lib/weather";
import { mondayOfWeek, weekdayLabel } from "@/lib/week";
import {
  compactDayViewsForPrompt,
  compactPlanForPrompt,
  getWeeklyPlanView,
} from "@/lib/weekly-plan";

export const runtime = "nodejs";
export const maxDuration = 60;

const WEEKDAY_FULL: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const dayBriefSchema = z.object({
  brief: z
    .string()
    .describe(
      "2 to 4 short paragraphs of plain-text coaching for this day only",
    ),
  nutrition: z
    .array(
      z.object({
        name: z
          .string()
          .describe("Exact name of a pantry item that fits this session"),
        notes: z
          .string()
          .describe(
            "One or two sentences on timing and why for this session, not the full pantry description",
          ),
      }),
    )
    .describe(
      "Pantry items that fit this session. Empty when none fit. Never invent a product.",
    ),
});

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = assertGoogleGenerativeAiApiKey();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid API key config";
    return Response.json({ error: message }, { status: 500 });
  }

  let date: string;
  try {
    const json: unknown = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json({ error: "Invalid date" }, { status: 400 });
    }
    date = parsed.data.date;
  } catch {
    return Response.json({ error: "Invalid date" }, { status: 400 });
  }

  const weekday = WEEKDAY_FULL[weekdayLabel(date)] ?? weekdayLabel(date);
  const google = createGoogleGenerativeAI({ apiKey });

  let systemPrompt: string;
  try {
    const garminSync = await maybeQuietGarminSync();
    const telemetry = await getAllTelemetry();
    ({ systemPrompt } = await assembleSystemPrompt(telemetry, {
      garminNote: garminNoteFromQuiet(garminSync),
    }));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build coach context";
    console.error("[api/plan/day] context", err);
    return Response.json({ error: message }, { status: 500 });
  }

  const profile = loadAthleteProfile();
  const pantryNames = new Map(
    profile.pantry
      .filter((item) => item.name.trim())
      .map((item) => [item.name.trim().toLowerCase(), item.name.trim()]),
  );
  const dateWeekView = await getWeeklyPlanView(mondayOfWeek(date));
  const dateWeekDay = dateWeekView.days.find((d) => d.date === date);
  let lastForecastDate: string | null = null;
  try {
    const weather = await getWeatherContext(profile.location);
    lastForecastDate = weather?.lastForecastDate ?? null;
  } catch {
    lastForecastDate = null;
  }
  const forecastCoversDate = lastForecastDate
    ? date <= lastForecastDate
    : false;
  const hasActuals = (dateWeekDay?.actual.activities.length ?? 0) > 0;

  systemPrompt = [
    systemPrompt,
    "",
    `## Focus day ${date}`,
    JSON.stringify(
      {
        note: "This is the date the athlete opened. Card chrome already shows kind, title, miles, duration, intensity, and session notes.",
        weekStart: dateWeekView.weekStart,
        plan: compactPlanForPrompt(dateWeekView.plan),
        day: compactDayViewsForPrompt(dateWeekDay ? [dateWeekDay] : []),
        weekDays: compactDayViewsForPrompt(dateWeekView.days),
      },
      null,
      2,
    ),
  ].join("\n");

  const prompt = [
    `Coach ${weekday} ${date} only. Do not rewrite other days.`,
    "The card already shows kind, title, mileage, duration, intensity, and session notes. Do not restate those or recap the prescription in the opening.",
    "Write 2 to 4 short paragraphs in brief: how to execute the session, why it sits in this week, and the lift if one is assigned.",
    "In brief, name which pantry item or items fit this session. If none fit, say so in one sentence. Also fill nutrition with those same items: notes is one or two sentences on timing and why, not the full stored description, and name is the exact pantry name. If none fit, leave nutrition empty. Do not invent supplements that are not in the pantry.",
    hasActuals
      ? "Compare Strava actuals for that date with the prescription."
      : "Do not mention Strava, actuals, that the day is upcoming, or that there is nothing to compare.",
    forecastCoversDate
      ? "Mention weather only if it changes how to run the session."
      : "Do not mention weather, the forecast, or that the horizon does not reach this date.",
    "Never mention the plan strip, Regenerate, stored prescriptions, or missing calendar data.",
  ].join(" ");

  try {
    const { object } = await generateObject({
      model: google("gemini-flash-latest"),
      schema: dayBriefSchema,
      schemaName: "DayBrief",
      schemaDescription:
        "Plain-text day brief plus pantry items that fit this session.",
      system: systemPrompt,
      prompt,
    });
    const seen = new Set<string>();
    const nutrition = object.nutrition.flatMap((item) => {
      const canonical = pantryNames.get(item.name.trim().toLowerCase());
      const notes = item.notes.trim();
      if (!canonical || !notes || seen.has(canonical)) return [];
      seen.add(canonical);
      return [{ name: canonical, notes }];
    });
    return Response.json({ brief: object.brief, nutrition });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Brief failed";
    console.error("[api/plan/day]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
