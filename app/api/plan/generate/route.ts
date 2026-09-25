import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  generateWeeklyPlan,
  PlanValidationError,
} from "@/lib/weekly-plan-generate";
import { getWeeklyPlanView } from "@/lib/weekly-plan";
import { currentMondayKey, mondayOfWeek } from "@/lib/week";
import { attachPlanWeather } from "@/lib/weather";
import { CHAT_GUIDANCE_MAX } from "@/lib/chat-guidance";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  weekStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  chatGuidance: z.string().max(CHAT_GUIDANCE_MAX).optional(),
});

export async function POST(req: NextRequest) {
  let weekStart: string | undefined;
  let chatGuidance: string | undefined;
  try {
    const json: unknown = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    weekStart = parsed.data.weekStart;
    const trimmed = parsed.data.chatGuidance?.trim();
    chatGuidance = trimmed ? trimmed : undefined;
  } catch {
    weekStart = undefined;
    chatGuidance = undefined;
  }

  const monday = mondayOfWeek(weekStart ?? currentMondayKey());

  try {
    const plan = await generateWeeklyPlan(monday, { chatGuidance });
    const view = await attachPlanWeather(
      await getWeeklyPlanView(plan.weekStart),
    );
    return NextResponse.json(view);
  } catch (err) {
    if (err instanceof PlanValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Plan generation failed";
    console.error("[api/plan/generate]", err);
    if (/API key|UNAUTHENTICATED|invalid authentication|API_KEY/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Gemini rejected the API key. Confirm GOOGLE_GENERATIVE_AI_API_KEY in .env.local.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
