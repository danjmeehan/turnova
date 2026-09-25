import type { UIMessage } from "ai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const DEFAULT_CHAT_ID = "default";
const MODEL_WINDOW = 40;

function asMessages(value: unknown): UIMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is UIMessage =>
      Boolean(m) &&
      typeof m === "object" &&
      typeof (m as UIMessage).id === "string" &&
      typeof (m as UIMessage).role === "string",
  );
}

export function messagesForModel(messages: UIMessage[]): UIMessage[] {
  if (messages.length <= MODEL_WINDOW) return messages;
  return messages.slice(-MODEL_WINDOW);
}

export async function loadChatThread(): Promise<UIMessage[]> {
  const row = await prisma.chatThread.findUnique({
    where: { id: DEFAULT_CHAT_ID },
  });
  return asMessages(row?.messages);
}

export async function saveChatThread(messages: UIMessage[]): Promise<void> {
  const payload = JSON.parse(JSON.stringify(messages)) as Prisma.InputJsonValue;
  await prisma.chatThread.upsert({
    where: { id: DEFAULT_CHAT_ID },
    create: { id: DEFAULT_CHAT_ID, messages: payload },
    update: { messages: payload },
  });
}
