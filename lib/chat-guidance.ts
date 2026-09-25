export const CHAT_GUIDANCE_MAX = 8000;
export const CHAT_GUIDANCE_TURNS = 8;
const TURN_CHARS = 1500;

export function formatChatGuidance(
  turns: Array<{ role: string; text: string }>,
): string {
  const body = turns
    .filter((t) => t.text.trim())
    .slice(-CHAT_GUIDANCE_TURNS)
    .map((t) => {
      const who = t.role === "user" ? "Athlete" : "Coach";
      return `${who}: ${t.text.trim().slice(0, TURN_CHARS)}`;
    })
    .join("\n\n");
  return body.slice(0, CHAT_GUIDANCE_MAX);
}

let latest = "";

export function publishRecentChatGuidance(text: string): void {
  latest = text.slice(0, CHAT_GUIDANCE_MAX);
}

export function readRecentChatGuidance(): string {
  return latest;
}

export const PROPOSE_WEEK_UPDATE_TOOL = "proposeWeekUpdate";

export function messageProposesWeekUpdate(message: {
  role: string;
  parts?: Array<{ type: string; toolName?: string }>;
}): boolean {
  if (message.role !== "assistant" || !message.parts?.length) return false;
  return message.parts.some((part) => {
    if (part.type === `tool-${PROPOSE_WEEK_UPDATE_TOOL}`) return true;
    if (
      part.type === "dynamic-tool" &&
      part.toolName === PROPOSE_WEEK_UPDATE_TOOL
    ) {
      return true;
    }
    return (
      typeof part.type === "string" &&
      part.type.includes(PROPOSE_WEEK_UPDATE_TOOL)
    );
  });
}

export function notifyPlanUpdated(detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("turnova:plan-updated", { detail: detail ?? null }),
  );
}

export async function postWeeklyPlanGenerate(input: {
  weekStart?: string;
  chatGuidance?: string;
}): Promise<{ weekStart: string; days: Array<{ date: string }> }> {
  const guidance = input.chatGuidance?.trim().slice(0, CHAT_GUIDANCE_MAX);
  const res = await fetch("/api/plan/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      weekStart: input.weekStart,
      chatGuidance: guidance || undefined,
    }),
  });
  const body = (await res.json()) as {
    weekStart?: string;
    days?: Array<{ date: string }>;
    error?: string;
  };
  if (!res.ok || !body.weekStart || !body.days) {
    throw new Error(body.error || `Generate failed (${res.status})`);
  }
  return body as { weekStart: string; days: Array<{ date: string }> };
}
