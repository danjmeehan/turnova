import {
  convertToModelMessages,
  generateId,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { assembleSystemPrompt } from "@/lib/context";
import { assertGoogleGenerativeAiApiKey } from "@/lib/env";
import {
  garminNoteFromQuiet,
  maybeQuietGarminSync,
} from "@/lib/garmin/sync";
import { getAllTelemetry } from "@/lib/telemetry";
import {
  loadChatThread,
  messagesForModel,
  saveChatThread,
} from "@/lib/chat-thread";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const messages = await loadChatThread();
    return Response.json({ messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load chat";
    console.error("[api/chat] load", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = assertGoogleGenerativeAiApiKey();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid API key config";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Explicit provider init with sanitized env key (supports AIza… and AQ… AI Studio keys).
  const google = createGoogleGenerativeAI({ apiKey });

  const body = (await req.json()) as { messages: UIMessage[] };
  const messages = body.messages ?? [];

  try {
    await saveChatThread(messages);
  } catch (err) {
    console.error("[api/chat] persist start", err);
  }

  let systemPrompt: string;
  try {
    const garminSync = await maybeQuietGarminSync();
    const telemetry = await getAllTelemetry();
    ({ systemPrompt } = await assembleSystemPrompt(telemetry, {
      garminNote: garminNoteFromQuiet(garminSync),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build coach context";
    console.error("[api/chat] context", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const modelMessages = await convertToModelMessages(messagesForModel(messages));

  const result = streamText({
    // Prefer stable free-tier alias; gemini-2.0-flash is often quota-blocked (limit 0) for new projects.
    model: google("gemini-flash-latest"),
    system: systemPrompt,
    messages: modelMessages,
    stopWhen: stepCountIs(2),
    tools: {
      proposeWeekUpdate: tool({
        description:
          "Call only after you have given a concrete change to this week's stored training days (swap days, rest, mileage, or session kind) that the athlete can save with Update this week. Do not call for sleep, PRs, race history, hypotheticals, or look-ahead-only talk.",
        inputSchema: z.object({
          summary: z
            .string()
            .describe(
              "One sentence of the agreed change, e.g. move Saturday 4 miles to Friday and rest Saturday.",
            ),
        }),
        execute: async () => ({ ready: true as const }),
      }),
    },
  });

  const assistantCreatedAt = new Date().toISOString();
  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: generateId,
    messageMetadata: () => ({ createdAt: assistantCreatedAt }),
    onFinish: async ({ messages: next }) => {
      try {
        await saveChatThread(next);
      } catch (err) {
        console.error("[api/chat] persist finish", err);
      }
    },
    onError: (error) => {
      console.error("[api/chat]", error);
      if (error instanceof Error) {
        if (
          /API key|UNAUTHENTICATED|invalid authentication|API_KEY|ACCESS_TOKEN/i.test(
            error.message,
          )
        ) {
          return "Gemini rejected the API key. Confirm GOOGLE_GENERATIVE_AI_API_KEY in .env.local is a valid Generative Language API key (no quotes, no trailing spaces), then restart npm run dev. https://aistudio.google.com/apikey";
        }
        return error.message;
      }
      return "Chat request failed";
    },
  });
}
