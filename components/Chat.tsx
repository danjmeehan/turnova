"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ProfileEditor } from "@/components/ProfileEditor";
import { RunnerLogo } from "@/components/RunnerLogo";
import { GarminControls } from "@/components/GarminControls";
import { HeaderSync } from "@/components/HeaderSync";
import { StravaControls } from "@/components/StravaControls";
import { SyncStatusProvider } from "@/components/sync-status";
import { LogoutButton } from "@/components/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WeekPlan } from "@/components/WeekPlan";
import { toConversationalPlainText } from "@/lib/plain-text";
import {
  formatChatGuidance,
  messageProposesWeekUpdate,
  notifyPlanUpdated,
  postWeeklyPlanGenerate,
  publishRecentChatGuidance,
} from "@/lib/chat-guidance";
import { currentMondayKey } from "@/lib/week";

type ChatMetadata = { createdAt?: string };
type ChatMessage = UIMessage<ChatMetadata>;

function messageText(message: {
  parts?: Array<{ type: string; text?: string }>;
  content?: string;
}): string {
  let text = "";
  if (message.parts?.length) {
    text = message.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  } else if (typeof message.content === "string") {
    text = message.content;
  }
  return toConversationalPlainText(text);
}

function formatChatTime(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function messageCreatedAt(message: UIMessage): string | undefined {
  const meta = message.metadata;
  if (meta && typeof meta === "object" && "createdAt" in meta) {
    const value = (meta as ChatMetadata).createdAt;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

const THINKING_LINES = [
  "Coach is thinking…",
  "Pulling in your profile and doctrine…",
  "Checking Strava and readiness…",
  "Working out a Norwegian-method take…",
];

const QUICK_PROMPTS = [
  "How was my last run?",
  "How has my recent sleep been?",
] as const;

function CoachAvatar() {
  return (
    <div className="chat-image avatar">
      <div className="flex w-10 items-center justify-center bg-primary text-primary-content">
        <RunnerLogo className="size-6" />
      </div>
    </div>
  );
}

function DanAvatar() {
  return (
    <div className="chat-image avatar avatar-placeholder">
      <div className="flex w-10 items-center justify-center bg-neutral text-neutral-content">
        <span>D</span>
      </div>
    </div>
  );
}

function ThinkingBubble({ visible }: { visible: boolean }) {
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    if (!visible) {
      setLineIndex(0);
      return;
    }
    const id = window.setInterval(() => {
      setLineIndex((i) => (i + 1) % THINKING_LINES.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="chat chat-start" aria-live="polite" aria-busy="true">
      <CoachAvatar />
      <div className="chat-bubble chat-bubble-neutral">
        <div className="flex items-center gap-3">
          <span className="loading loading-dots loading-md text-primary" />
          <span className="text-base font-medium">
            {THINKING_LINES[lineIndex]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="badge badge-outline badge-primary badge-xs">
            context
          </span>
          <span className="badge badge-outline badge-secondary badge-xs">
            training
          </span>
          <span className="badge badge-outline badge-xs">recovery</span>
        </div>
      </div>
    </div>
  );
}

export function Chat() {
  const [initialMessages, setInitialMessages] = useState<ChatMessage[] | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/chat", { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json()) as {
          messages?: ChatMessage[];
          error?: string;
        };
        if (!r.ok) {
          throw new Error(body.error || "Failed to load chat");
        }
        return Array.isArray(body.messages) ? body.messages : [];
      })
      .then((messages) => {
        if (!cancelled) setInitialMessages(messages);
      })
      .catch(() => {
        if (!cancelled) setInitialMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (initialMessages === null) {
    return (
      <div
        className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-3 sm:px-6"
        style={{
          paddingTop: "max(0.75rem, env(safe-area-inset-top))",
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
          paddingRight: "max(0.75rem, env(safe-area-inset-right))",
        }}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      </div>
    );
  }

  return (
    <SyncStatusProvider>
      <ChatSession initialMessages={initialMessages} />
    </SyncStatusProvider>
  );
}

function ChatSession({ initialMessages }: { initialMessages: ChatMessage[] }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [input, setInput] = useState("");
  const [weekBusy, setWeekBusy] = useState(false);
  const [weekToast, setWeekToast] = useState<string | null>(null);
  const [appliedProposalId, setAppliedProposalId] = useState<string | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoredScroll = useRef(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    id: "default",
    messages: initialMessages,
    transport,
  });

  const isLoading = status === "submitted" || status === "streaming";

  const lastMessage = messages[messages.length - 1];
  const lastAssistantEmpty =
    lastMessage?.role === "assistant" && !messageText(lastMessage);
  const showThinking =
    status === "submitted" ||
    (status === "streaming" &&
      (lastMessage?.role !== "assistant" || lastAssistantEmpty));

  useEffect(() => {
    void fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d: { enabled?: boolean }) => setAuthEnabled(Boolean(d.enabled)))
      .catch(() => setAuthEnabled(false));
  }, []);

  useEffect(() => {
    const behavior = restoredScroll.current ? "smooth" : "auto";
    restoredScroll.current = true;
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, [messages, showThinking, status]);

  useEffect(() => {
    resizeComposer();
  }, [input]);

  useEffect(() => {
    publishRecentChatGuidance(
      formatChatGuidance(
        messages.map((m) => ({ role: m.role, text: messageText(m) })),
      ),
    );
  }, [messages]);

  useEffect(() => {
    if (!weekToast) return;
    const id = window.setTimeout(() => setWeekToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [weekToast]);

  async function sendPrompt(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    await sendMessage({
      text: trimmed,
      metadata: { createdAt: new Date().toISOString() },
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await sendPrompt(text);
  }

  function resizeComposer() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }

  const hasUserMessage = messages.some((m) => m.role === "user");
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const showUpdateWeek = Boolean(
    lastAssistant &&
      messageProposesWeekUpdate(lastAssistant) &&
      lastAssistant.id !== appliedProposalId,
  );

  async function onUpdateWeek() {
    if (weekBusy || isLoading || !hasUserMessage || !showUpdateWeek) return;
    setWeekBusy(true);
    setWeekToast(null);
    try {
      const view = await postWeeklyPlanGenerate({
        weekStart: currentMondayKey(),
        chatGuidance: formatChatGuidance(
          messages.map((m) => ({ role: m.role, text: messageText(m) })),
        ),
      });
      notifyPlanUpdated(view);
      if (lastAssistant) setAppliedProposalId(lastAssistant.id);
      setWeekToast("Week strip updated from this chat.");
    } catch (err) {
      setWeekToast(err instanceof Error ? err.message : "Update this week failed");
    } finally {
      setWeekBusy(false);
    }
  }

  return (
    <div
      className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-3 sm:px-6"
      style={{
        paddingTop: "max(0.75rem, env(safe-area-inset-top))",
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
        paddingRight: "max(0.75rem, env(safe-area-inset-right))",
      }}
    >
      <header className="navbar z-20 mb-2 min-h-0 items-center overflow-visible border-b-[3px] border-neutral px-0 py-2">
        <div className="navbar-start min-w-0 gap-2.5">
          <RunnerLogo className="size-9 shrink-0 text-primary sm:size-10" />
          <h1 className="font-pixel text-base text-primary sm:text-xl">
            Turnova
          </h1>
        </div>
        <div className="navbar-end flex-wrap gap-1.5">
          <HeaderSync />
          <div className="dropdown dropdown-end z-30">
            <button
              type="button"
              tabIndex={0}
              className="bit-btn btn btn-sm"
            >
              Menu
            </button>
            <div
              tabIndex={0}
              className="dropdown-content card card-sm z-20 mt-2 w-72 bg-base-100 p-3"
            >
              <div className="card-body gap-3 p-0">
                <button
                  type="button"
                  onClick={() => setProfileOpen(true)}
                  className="btn btn-ghost btn-sm justify-start"
                >
                  Athlete profile
                </button>
                <Link
                  href="/help"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm justify-start"
                >
                  Help
                </Link>
                {authEnabled ? (
                  <LogoutButton className="btn btn-ghost btn-sm justify-start" />
                ) : null}
                <ThemeToggle />
                <div className="divider my-0" />
                <StravaControls />
                <GarminControls />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mb-3 shrink-0">
        <WeekPlan />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {messages.map((message) => {
          const text = messageText(message);
          const isUser = message.role === "user";
          const stamped = formatChatTime(messageCreatedAt(message));
          if (!text) return null;
          return (
            <div
              key={message.id}
              className={isUser ? "chat chat-end" : "chat chat-start"}
            >
              {isUser ? <DanAvatar /> : <CoachAvatar />}
              <div
                className={
                  isUser
                    ? "chat-bubble chat-bubble-primary whitespace-pre-wrap"
                    : "chat-bubble chat-bubble-neutral whitespace-pre-wrap"
                }
              >
                {text}
              </div>
              {stamped ? (
                <div className="chat-footer text-sm text-base-content/80">
                  {stamped}
                </div>
              ) : null}
            </div>
          );
        })}

        <ThinkingBubble visible={showThinking} />
        <div ref={bottomRef} />
      </div>

      {error && (
        <div role="alert" className="alert alert-error mb-2 py-2 text-sm">
          <span>{error.message || "Chat request failed"}</span>
        </div>
      )}

      <div className="border-t-[3px] border-neutral bg-base-100 pt-3">
        <div className="mb-2 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className={`badge badge-outline badge-lg prompt-chip h-auto max-w-full cursor-pointer whitespace-normal rounded-full border px-3 py-2 font-normal ${
                isLoading ? "pointer-events-none opacity-50" : ""
              }`}
              disabled={isLoading}
              onClick={() => void sendPrompt(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-end gap-2"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            requestAnimationFrame(resizeComposer);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const form = e.currentTarget.form;
              if (form) form.requestSubmit();
            }
          }}
          placeholder="Ask your coach…"
          rows={1}
          className="textarea textarea-bordered min-h-12 min-w-0 flex-1 resize-none overflow-y-auto bg-base-100 text-base leading-relaxed break-words whitespace-pre-wrap"
          disabled={isLoading}
          autoComplete="off"
        />
        {showUpdateWeek ? (
          <button
            type="button"
            className="bit-btn btn h-12 min-h-12 shrink-0"
            disabled={isLoading || weekBusy}
            onClick={() => void onUpdateWeek()}
          >
            {weekBusy ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              "Update this week"
            )}
          </button>
        ) : null}
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="btn btn-primary h-12 min-h-12"
        >
          {isLoading ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            "Send"
          )}
        </button>
      </form>
      </div>

      {weekToast
        ? createPortal(
            <div className="toast toast-end z-[80]">
              <div
                role="status"
                className={`alert ${
                  /fail|error|invalid/i.test(weekToast)
                    ? "alert-error"
                    : "alert-success"
                } py-2 text-sm`}
              >
                <span>{weekToast}</span>
              </div>
            </div>,
            document.body,
          )
        : null}

      <ProfileEditor open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
