import { NextRequest, NextResponse } from "next/server";
import {
  getWeeklyPlanView,
  getWeeklyPlanViews,
} from "@/lib/weekly-plan";
import { currentMondayKey, mondayOfWeek, todayDateKey } from "@/lib/week";
import {
  attachPlanWeather,
  attachPlanWeatherMany,
} from "@/lib/weather";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const weekStartParam = req.nextUrl.searchParams.get("weekStart");
  const weekStart =
    weekStartParam && /^\d{4}-\d{2}-\d{2}$/.test(weekStartParam)
      ? mondayOfWeek(weekStartParam)
      : currentMondayKey();

  const weeksRaw = req.nextUrl.searchParams.get("weeks");
  const weeksCount = weeksRaw == null || weeksRaw === "" ? 1 : Number(weeksRaw);
  if (!Number.isFinite(weeksCount) || weeksCount < 1 || weeksCount > 8) {
    return NextResponse.json(
      { error: "weeks must be an integer from 1 to 8" },
      { status: 400 },
    );
  }

  try {
    if (weeksCount === 1) {
      const view = await attachPlanWeather(await getWeeklyPlanView(weekStart));
      return NextResponse.json(view);
    }

    const views = await getWeeklyPlanViews(weekStart, weeksCount);
    const weeks = await attachPlanWeatherMany(views);
    return NextResponse.json({ weeks, today: todayDateKey() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load plan";
    console.error("[api/plan]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
