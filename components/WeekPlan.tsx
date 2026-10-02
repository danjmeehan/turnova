"use client";

import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendar,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import { toConversationalPlainText } from "@/lib/plain-text";
import {
  postWeeklyPlanGenerate,
  readRecentChatGuidance,
} from "@/lib/chat-guidance";
import { RunnerLogo } from "@/components/RunnerLogo";

type DayNutrition = {
  name: string;
  notes: string;
};

type CachedDayBrief = {
  brief: string;
  nutrition: DayNutrition[];
};

type PlanKind =
  | "easy"
  | "lt1"
  | "lt2"
  | "double_threshold"
  | "long"
  | "rest"
  | "race"
  | "other";

type DayStatus =
  | "upcoming"
  | "rest_ok"
  | "done"
  | "extra"
  | "missed"
  | "partial";

type PlanDay = {
  date: string;
  weekday: string;
  kind: PlanKind;
  title: string;
  durationMin: number | null;
  miles: number | null;
  intensity: string;
  sessionNotes: string;
  strength: {
    title: string;
    durationMin: number | null;
    notes: string;
  } | null;
  nutrition?: DayNutrition[];
};

type WeatherIconKind =
  | "sun"
  | "partly"
  | "cloud"
  | "fog"
  | "rain"
  | "storm"
  | "snow";

type DayWeather = {
  icon: WeatherIconKind;
  highF: number;
  lowF: number;
  condition: string;
};

type PlanDayView = {
  date: string;
  weekday: string;
  prescribed: PlanDay | null;
  actual: {
    miles: number;
    movingMin: number;
    activities: Array<{
      name: string;
      kindLabel: string;
      miles: number | null;
      pace: string | null;
      movingMin: number | null;
    }>;
  };
  status: DayStatus;
  weather?: DayWeather | null;
};

type WeeklyPlanView = {
  weekStart: string;
  plan: {
    weekStart: string;
    intent: string;
    weeksOut: number | null;
    rationale: string | null;
    generatedAt: string;
  } | null;
  days: PlanDayView[];
};

const KIND_LABEL: Record<PlanKind, string> = {
  easy: "Easy",
  lt1: "LT1",
  lt2: "LT2",
  double_threshold: "Double T",
  long: "Long",
  rest: "Rest",
  race: "Race",
  other: "Other",
};

const INTENT_LABEL: Record<string, string> = {
  build: "Build",
  recover: "Recover",
  race_week: "Race",
  taper: "Taper",
  deload: "Deload",
};

function kindBadgeClass(kind: PlanKind): string {
  if (kind === "rest") return "badge-ghost";
  if (kind === "easy" || kind === "lt1") return "badge-outline";
  if (kind === "lt2" || kind === "double_threshold") return "badge-primary";
  if (kind === "race") return "badge-secondary";
  if (kind === "long") return "badge-accent";
  return "badge-outline";
}

function intentBadgeClass(intent: string | null | undefined): string {
  if (intent === "race_week") return "badge-secondary";
  if (intent === "build") return "badge-primary";
  if (intent === "taper") return "badge-accent";
  if (intent === "recover" || intent === "deload") return "badge-ghost";
  return "badge-outline";
}

function statusBorder(status: DayStatus): string {
  if (status === "missed") return "border-error/50";
  if (status === "extra" || status === "partial") return "border-warning/50";
  if (status === "done" || status === "rest_ok") return "border-success/40";
  return "border-base-200";
}

function overlayLine(day: PlanDayView): string {
  if (day.status === "missed") return "missed";
  if (day.actual.activities.length === 0) return "—";
  const miles = day.actual.miles;
  const paces = day.actual.activities
    .map((a) => a.pace)
    .filter((p): p is string => Boolean(p));
  const pace =
    paces.length === 1 ? paces[0].replace(/\/mi$/, "") : null;
  if (pace) return `${miles} mi @ ${pace}`;
  if (miles > 0) return `${miles} mi`;
  return day.actual.activities[0]?.name ?? "done";
}

function overlayBadgeClass(status: DayStatus): string | null {
  if (status === "missed") return "badge badge-sm badge-error";
  if (status === "extra" || status === "partial") return "badge badge-sm badge-warning";
  if (status === "done" || status === "rest_ok") return "badge badge-sm badge-success";
  return null;
}

function RestDoneCheck() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className="size-4 shrink-0"
      strokeWidth="2"
      aria-label="Done"
      role="img"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function StatusOverlay({ day }: { day: PlanDayView }) {
  const badge = overlayBadgeClass(day.status);
  const inner =
    day.status === "rest_ok" ? <RestDoneCheck /> : overlayLine(day);
  if (badge) {
    return <span className={badge}>{inner}</span>;
  }
  return <span className="text-sm font-medium text-base-content/80">{inner}</span>;
}

function showsCardStatus(day: PlanDayView): boolean {
  if (day.status === "rest_ok") return true;
  return overlayLine(day) !== "—";
}

function prescribedLine(day: PlanDayView): string {
  const p = day.prescribed;
  if (!p) return "Unplanned";
  if (p.kind === "rest") return p.intensity || "Rest";
  const bits: string[] = [];
  if (p.miles != null) bits.push(`${p.miles} mi`);
  else if (p.durationMin != null) bits.push(`${p.durationMin} min`);
  if (p.intensity) bits.push(p.intensity);
  return bits.join(" · ") || p.title;
}

function intentBits(plan: WeeklyPlanView["plan"]): string[] {
  if (!plan) return [];
  const bits: string[] = [];
  const intentLabel = plan.intent
    ? (INTENT_LABEL[plan.intent] ?? plan.intent)
    : null;
  if (intentLabel) bits.push(intentLabel);
  if (plan.weeksOut != null && plan.weeksOut > 0) {
    bits.push(
      `${plan.weeksOut} week${plan.weeksOut === 1 ? "" : "s"} out`,
    );
  }
  return bits;
}

function weekHeadingText(
  view: WeeklyPlanView | null,
  loading: boolean,
): string {
  if (view) return formatRangeFriendly(view.weekStart, view.days);
  return loading ? "Loading…" : "—";
}

function WeekIntentBadges({ plan }: { plan: WeeklyPlanView["plan"] }) {
  if (!plan) return null;
  const intentLabel = plan.intent
    ? (INTENT_LABEL[plan.intent] ?? plan.intent)
    : null;
  return (
    <>
      {intentLabel ? (
        <span
          className={`bit-badge badge badge-sm ${intentBadgeClass(plan.intent)}`}
        >
          {intentLabel}
        </span>
      ) : null}
      {plan.weeksOut != null && plan.weeksOut > 0 ? (
        <span className="bit-badge badge badge-sm badge-ghost">
          {plan.weeksOut} wk{plan.weeksOut === 1 ? "" : "s"} out
        </span>
      ) : null}
    </>
  );
}

function CoachBriefBody({
  rationale,
  clamp = false,
}: {
  rationale: string;
  clamp?: boolean;
}) {
  return (
    <>
      <div className="flex size-8 shrink-0 items-center justify-center bg-primary text-primary-content">
        <RunnerLogo className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-pixel text-[10px] text-primary">Coach brief</p>
        <p
          className={`mt-1 text-sm leading-relaxed text-base-content/80 ${
            clamp ? "line-clamp-2 group-open:line-clamp-none" : ""
          }`}
        >
          {rationale}
        </p>
      </div>
    </>
  );
}

function WeatherGlyph({ icon }: { icon: WeatherIconKind }) {
  const common = {
    viewBox: "0 0 16 16",
    width: 16,
    height: 16,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className: "shrink-0",
  };
  switch (icon) {
    case "sun":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.6" />
          <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M3.3 12.7l1.1-1.1M11.6 4.4l1.1-1.1" />
        </svg>
      );
    case "partly":
      return (
        <svg {...common}>
          <circle cx="6.2" cy="6" r="2" />
          <path d="M6.2 2.4v.9M2.8 6h.9M3.6 3.6l.6.6M8.8 3.6l-.6.6" />
          <path d="M11.4 8.2a2.3 2.3 0 0 0-4.3.7 2 2 0 0 0 .3 4h4.4a2.1 2.1 0 0 0 0-4.2h-.4" />
        </svg>
      );
    case "cloud":
      return (
        <svg {...common}>
          <path d="M12 7.4a2.4 2.4 0 0 0-4.5.8 2.1 2.1 0 0 0 .3 4.1h4.6a2.2 2.2 0 0 0 0-4.4h-.4" />
        </svg>
      );
    case "fog":
      return (
        <svg {...common}>
          <path d="M3 6.2h10M4 8.5h8M5 10.8h6" />
        </svg>
      );
    case "rain":
      return (
        <svg {...common}>
          <path d="M11.6 5.6a2.2 2.2 0 0 0-4.1.7 1.9 1.9 0 0 0 .2 3.7h4.2a2 2 0 0 0 0-4h-.3" />
          <path d="M6 11.4l-.6 2M8.2 11.4l-.6 2M10.4 11.4l-.6 2" />
        </svg>
      );
    case "storm":
      return (
        <svg {...common}>
          <path d="M11.6 5.4a2.2 2.2 0 0 0-4.1.7 1.9 1.9 0 0 0 .2 3.6h4.2a2 2 0 0 0 0-4h-.3" />
          <path d="M8.6 9.8 7 12.2h2.1L7.6 14.6" />
        </svg>
      );
    case "snow":
      return (
        <svg {...common}>
          <path d="M11.6 5.4a2.2 2.2 0 0 0-4.1.7 1.9 1.9 0 0 0 .2 3.6h4.2a2 2 0 0 0 0-4h-.3" />
          <path d="M6.2 12.2v2M5.2 12.7l2 1M7.2 12.7l-2 1M10 12.2v2M9 12.7l2 1M11 12.7l-2 1" />
        </svg>
      );
  }
}

function DayWeatherChip({ weather }: { weather: DayWeather }) {
  const label = `${weather.condition}, high ${weather.highF} low ${weather.lowF}`;
  return (
    <div
      className="flex items-center gap-1 text-base-content/80"
      title={label}
      aria-label={label}
    >
      <WeatherGlyph icon={weather.icon} />
      <span className="text-xs tabular-nums">
        {weather.highF}°/{weather.lowF}°
      </span>
    </div>
  );
}

function kindBarClass(kind: PlanKind): string {
  if (kind === "easy" || kind === "lt1") return "border-l-success";
  if (kind === "lt2" || kind === "double_threshold") return "border-l-primary";
  if (kind === "long") return "border-l-accent";
  if (kind === "race") return "border-l-secondary";
  return "border-l-base-300";
}

function formatMonthDay(dateKey: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  return `${months[month - 1] ?? dateKey.slice(5, 7)} ${day}`;
}

function formatRangeFriendly(weekStart: string, days: PlanDayView[]): string {
  const end = days[6]?.date ?? weekStart;
  return `${formatMonthDay(weekStart)} – ${formatMonthDay(end)}`;
}

function prescribedMiles(week: WeeklyPlanView): number {
  return Math.round(
    week.days.reduce((sum, d) => sum + (d.prescribed?.miles ?? 0), 0) * 10,
  ) / 10;
}

function actualMiles(week: WeeklyPlanView): number {
  return Math.round(week.days.reduce((sum, d) => sum + d.actual.miles, 0) * 10) / 10;
}

function weekHeading(
  week: WeeklyPlanView,
  index: number,
  currentMonday: string | null,
): string {
  if (currentMonday && week.weekStart === currentMonday) return "This week";
  if (week.plan?.weeksOut != null) {
    return week.plan.weeksOut === 0
      ? "Race week"
      : `${week.plan.weeksOut} week${week.plan.weeksOut === 1 ? "" : "s"} out`;
  }
  if (index === 1) return "Next week";
  return `${index} weeks ahead`;
}

function CalendarDayRow({
  day,
  today,
  onSelect,
}: {
  day: PlanDayView;
  today: string | null;
  onSelect: (day: PlanDayView) => void;
}) {
  const isToday = Boolean(today && day.date === today);
  const dateNum = Number(day.date.slice(8, 10));
  const prescribed = day.prescribed;
  const isRest = !prescribed || prescribed.kind === "rest";
  const label = `${day.weekday} ${day.date.slice(5)}`;

  return (
    <div className="flex items-stretch gap-2">
      <div className="flex w-11 shrink-0 flex-col items-center pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-base-content/55">
          {day.weekday}
        </span>
        <span
          className={
            isToday
              ? "mt-0.5 flex size-7 items-center justify-center bg-primary text-sm font-semibold text-primary-content"
              : "mt-0.5 text-sm tabular-nums text-base-content/80"
          }
        >
          {dateNum}
        </span>
      </div>
      {isRest ? (
        <button
          type="button"
          className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-between px-2 py-1.5 text-left text-sm text-base-content/80 transition-colors hover:bg-base-300"
          aria-label={label}
          onClick={() => onSelect(day)}
        >
          <span>{prescribed?.title ?? "Rest"}</span>
          <span className="flex shrink-0 items-center gap-2">
            {day.status === "rest_ok" ? (
              <span className="badge badge-sm badge-success">
                <RestDoneCheck />
              </span>
            ) : null}
            {day.weather ? <DayWeatherChip weather={day.weather} /> : null}
          </span>
        </button>
      ) : (
        <button
          type="button"
          className={`bit-card flex min-w-0 flex-1 cursor-pointer gap-2 border-neutral border-l-4 bg-base-200 px-2.5 py-2 text-left transition-colors hover:bg-base-300 ${kindBarClass(prescribed.kind)}`}
          aria-label={label}
          onClick={() => onSelect(day)}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug text-base-content">
              {prescribed.title}
            </p>
            <p className="mt-0.5 text-sm leading-snug text-base-content/70">
              {prescribedLine(day)}
            </p>
            <p className="mt-1">
              <StatusOverlay day={day} />
            </p>
            {prescribed.strength ? (
              <p className="mt-1 text-sm leading-snug text-base-content/70">
                Lift · {prescribed.strength.title}
              </p>
            ) : null}
          </div>
          {day.weather ? (
            <div className="shrink-0 self-start pt-0.5">
              <DayWeatherChip weather={day.weather} />
            </div>
          ) : null}
        </button>
      )}
    </div>
  );
}

function PlanCalendar({
  weeks,
  today,
  currentMonday,
  loading,
  error,
  generatingWeek,
  onGenerateWeek,
  onSelectDay,
  onClose,
}: {
  weeks: WeeklyPlanView[] | null;
  today: string | null;
  currentMonday: string | null;
  loading: boolean;
  error: string | null;
  generatingWeek: string | null;
  onGenerateWeek: (weekStart: string) => void;
  onSelectDay: (day: PlanDayView) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-base-300 px-4 py-3">
        <div>
          <h2
            id="week-plan-sheet-title"
            className="font-display text-lg font-semibold text-base-content"
          >
            Look ahead
          </h2>
          <p className="text-sm text-base-content/70">
            This week plus the next three
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {error ? (
          <div role="alert" className="alert alert-error py-2 text-sm">
            <span>{error}</span>
          </div>
        ) : null}

        {loading && !weeks ? (
          <div className="flex items-center gap-2 text-sm text-base-content/70">
            <span className="loading loading-spinner loading-sm text-primary" />
            Loading calendar…
          </div>
        ) : null}

        {(weeks ?? []).map((week, index) => {
          const hasPlan = Boolean(week.plan);
          const prescribed = prescribedMiles(week);
          const actual = actualMiles(week);
          const isCurrent = currentMonday === week.weekStart;
          const busy = generatingWeek === week.weekStart;
          return (
            <section key={week.weekStart} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-base-content">
                    {formatRangeFriendly(week.weekStart, week.days)}
                    <span className="ml-2 text-xs font-medium uppercase tracking-wide text-base-content/50">
                      {weekHeading(week, index, currentMonday)}
                    </span>
                  </p>
                  <p className="text-sm text-base-content/70">
                    {hasPlan
                      ? isCurrent && actual > 0
                        ? `Total: ${actual} / ${prescribed} mi`
                        : `Total: ${prescribed} mi`
                      : "No plan yet"}
                    {intentBits(week.plan)
                      .filter((bit) => !bit.includes("week"))
                      .map((bit) => ` · ${bit}`)
                      .join("")}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm shrink-0"
                  onClick={() => onGenerateWeek(week.weekStart)}
                  disabled={Boolean(generatingWeek)}
                >
                  {busy ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : hasPlan ? (
                    "Regenerate"
                  ) : (
                    "Plan this week"
                  )}
                </button>
              </div>
              <div className="space-y-1.5">
                {week.days.map((day) => (
                  <CalendarDayRow
                    key={day.date}
                    day={day}
                    today={today}
                    onSelect={onSelectDay}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

type PlanCardProps = {
  view: WeeklyPlanView | null;
  error: string | null;
  loading: boolean;
  generating: boolean;
  hasPlan: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onGenerate: () => void;
  onLookAhead?: () => void;
  onSelectDay?: (day: PlanDayView) => void;
  onClose?: () => void;
  className?: string;
  titleId?: string;
};

function PlanCard({
  view,
  error,
  loading,
  generating,
  hasPlan,
  expanded = true,
  onToggleExpanded,
  onGenerate,
  onLookAhead,
  onSelectDay,
  onClose,
  className = "card bg-base-100",
  titleId,
}: PlanCardProps) {
  const showWeatherSlot = Boolean(view?.days.some((d) => d.weather));
  const rationale = view?.plan?.rationale ?? "";
  const rationaleCollapsible = rationale.length > 140;
  const bodyId = "week-plan-card-body";

  return (
    <section className={className}>
      <div className="card-body">
      <header className={`${expanded ? "mb-1" : ""} flex flex-wrap items-center justify-between gap-2`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2
            id={titleId}
            className="font-display text-lg font-semibold text-base-content"
          >
            {weekHeadingText(view, loading)}
          </h2>
          <WeekIntentBadges plan={view?.plan ?? null} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {onToggleExpanded ? (
            <button
              type="button"
              className="btn btn-ghost btn-square"
              aria-label={expanded ? "Hide" : "Show"}
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={onToggleExpanded}
            >
              <FontAwesomeIcon
                icon={expanded ? faEye : faEyeSlash}
                className="size-6"
                aria-hidden
              />
            </button>
          ) : null}
          {onClose ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Close
            </button>
          ) : null}
          {onLookAhead ? (
            <button
              type="button"
              className="btn btn-ghost btn-square"
              aria-label="Look ahead"
              onClick={onLookAhead}
            >
              <FontAwesomeIcon
                icon={faCalendar}
                className="size-6"
                aria-hidden
              />
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={onGenerate}
            disabled={generating || loading}
          >
            {generating ? (
              <span className="loading loading-spinner loading-sm" />
            ) : hasPlan ? (
              "Regenerate"
            ) : (
              "Plan this week"
            )}
          </button>
        </div>
      </header>

      <div id={bodyId} hidden={!expanded}>
      {error && (
        <div role="alert" className="alert alert-error mb-2 py-2 text-sm">
          <span>{error}</span>
        </div>
      )}

      {rationale ? (
        rationaleCollapsible ? (
          <details className="bit-card group mb-3 bg-base-100">
            <summary
              className="flex cursor-pointer list-none items-start gap-3 px-3 py-2.5 marker:content-none [&::-webkit-details-marker]:hidden"
              aria-label="Coach brief"
            >
              <CoachBriefBody rationale={rationale} clamp />
              <svg
                className="mt-1 size-4 shrink-0 text-base-content/45 transition-transform group-open:rotate-180"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden
              >
                <path d="M4 6.5 8 10.5 12 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
          </details>
        ) : (
          <div
            className="bit-card mb-3 flex items-start gap-3 bg-base-100 px-3 py-2.5"
            role="note"
            aria-label="Coach brief"
          >
            <CoachBriefBody rationale={rationale} />
          </div>
        )
      ) : null}

      {!hasPlan && !loading && (
        <p className="mb-3 text-sm text-base-content/80">
          No plan for this week. Generate one from your profile, doctrine, and
          recent Strava.
        </p>
      )}

      <div className="-mx-1 overflow-x-auto pb-1">
        <div className="flex min-w-full items-stretch gap-2 bg-base-200 p-2">
          {(view?.days ?? []).length === 0
            ? Array.from({ length: 7 }, (_, i) => (
                <div
                  key={i}
                  className="bit-card min-h-[8.5rem] min-w-[8rem] flex-1 border-neutral bg-base-100"
                />
              ))
            : view!.days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  className={`bit-card flex h-full min-w-[8rem] flex-1 cursor-pointer flex-col bg-base-100 text-left ${statusBorder(d.status)}`}
                  aria-label={`${d.weekday} ${d.date.slice(5)}`}
                  onClick={() => onSelectDay?.(d)}
                >
                  <div className="flex flex-1 flex-col p-2.5">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="text-sm font-semibold uppercase tracking-wide text-base-content">
                        {d.weekday}
                      </span>
                      <span className="text-sm tabular-nums text-base-content/80">
                        {d.date.slice(5)}
                      </span>
                    </div>
                    {showWeatherSlot ? (
                      <div className="mt-1 min-h-5">
                        {d.weather ? <DayWeatherChip weather={d.weather} /> : null}
                      </div>
                    ) : null}
                    {d.prescribed ? (
                      <div
                        className={`bit-badge badge badge-sm mt-1.5 ${kindBadgeClass(d.prescribed.kind)}`}
                      >
                        {KIND_LABEL[d.prescribed.kind]}
                      </div>
                    ) : (
                      <div className="bit-badge badge badge-ghost badge-sm mt-1.5">—</div>
                    )}
                    <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-base-content">
                      {d.prescribed?.title ?? "—"}
                    </p>
                    <p className="mt-0.5 line-clamp-1 min-h-[1.25rem] text-sm leading-snug text-base-content/80">
                      {prescribedLine(d)}
                    </p>
                    <p className="mt-auto flex h-6 items-end">
                      <StatusOverlay day={d} />
                    </p>
                  </div>
                </button>
              ))}
        </div>
      </div>
      </div>
      </div>
    </section>
  );
}

function DayBriefSheet({
  day,
  brief,
  nutrition,
  loading,
  error,
  onClose,
}: {
  day: PlanDayView;
  brief: string;
  nutrition: DayNutrition[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const prescribed = day.prescribed;
  return (
    <div className="modal modal-open modal-bottom sm:modal-middle z-[1000]">
      <button
        type="button"
        className="modal-backdrop bg-neutral/40"
        aria-label="Close day brief"
        onClick={onClose}
      />
      <div
        className="modal-box m-0 flex max-h-[85dvh] w-full max-w-none flex-col overflow-hidden p-0 sm:max-w-lg"
        role="dialog"
        aria-labelledby="day-brief-title"
        style={{
          paddingBottom: "max(0px, env(safe-area-inset-bottom))",
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-base-300 px-4 py-3">
          <div className="min-w-0">
            <h2
              id="day-brief-title"
              className="font-display text-lg font-semibold text-base-content"
            >
              {day.weekday} {day.date.slice(5)}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {prescribed ? (
                <span className={`badge badge-sm ${kindBadgeClass(prescribed.kind)}`}>
                  {KIND_LABEL[prescribed.kind]}
                </span>
              ) : (
                <span className="badge badge-ghost badge-sm">—</span>
              )}
              {day.weather ? <DayWeatherChip weather={day.weather} /> : null}
            </div>
            <p className="mt-2 text-sm font-medium text-base-content">
              {prescribed?.title ?? "Unplanned"}
            </p>
            <p className="mt-0.5 text-sm text-base-content/70">
              {prescribedLine(day)}
            </p>
            {prescribed?.sessionNotes ? (
              <p className="mt-1 text-sm leading-relaxed text-base-content/80">
                {prescribed.sessionNotes}
              </p>
            ) : null}
            {prescribed?.strength ? (
              <div className="mt-2 space-y-0.5">
                <p className="text-sm font-medium text-base-content">
                  Lift
                  {prescribed.strength.durationMin != null
                    ? ` · ${prescribed.strength.durationMin} min`
                    : ""}
                  {prescribed.strength.title
                    ? ` · ${prescribed.strength.title}`
                    : ""}
                </p>
                {prescribed.strength.notes ? (
                  <p className="text-sm leading-relaxed text-base-content/80">
                    {prescribed.strength.notes}
                  </p>
                ) : null}
              </div>
            ) : null}
            {(prescribed?.nutrition?.length ?? 0) > 0 ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm font-medium text-base-content">Nutrition</p>
                <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-base-content/80">
                  {prescribed?.nutrition?.map((item) => (
                    <li key={item.name}>
                      <span className="font-medium text-base-content">
                        {item.name}.
                      </span>{" "}
                      {item.notes}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {showsCardStatus(day) ? (
              <p className="mt-1 flex items-center">
                <StatusOverlay day={day} />
              </p>
            ) : null}
          </div>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error ? (
            <div role="alert" className="alert alert-error py-2 text-sm">
              <span>{error}</span>
            </div>
          ) : null}
          {loading && !brief ? (
            <div className="flex items-center gap-2 text-sm text-base-content/70">
              <span className="loading loading-spinner loading-sm text-primary" />
              Coach is briefing this day…
            </div>
          ) : null}
          {brief ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-base-content">
              {brief}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function WeekPlan() {
  const [view, setView] = useState<WeeklyPlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [calendarWeeks, setCalendarWeeks] = useState<WeeklyPlanView[] | null>(
    null,
  );
  const [calendarToday, setCalendarToday] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [generatingWeek, setGeneratingWeek] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<PlanDayView | null>(null);
  const [cardExpanded, setCardExpanded] = useState(true);
  const [briefByDate, setBriefByDate] = useState<
    Record<string, CachedDayBrief>
  >({});
  const [briefText, setBriefText] = useState("");
  const [nutrition, setNutrition] = useState<DayNutrition[]>([]);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/plan");
      const body = (await res.json()) as WeeklyPlanView & { error?: string };
      if (!res.ok) {
        throw new Error(body.error || `Failed to load plan (${res.status})`);
      }
      setView(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plan");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const res = await fetch("/api/plan?weeks=4");
      const body = (await res.json()) as {
        weeks?: WeeklyPlanView[];
        today?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error || `Failed to load calendar (${res.status})`);
      }
      setCalendarWeeks(body.weeks ?? []);
      setCalendarToday(body.today ?? null);
    } catch (e) {
      setCalendarError(
        e instanceof Error ? e.message : "Failed to load calendar",
      );
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onStravaSynced() {
      void load();
      if (sheetOpen) void loadCalendar();
    }
    function onPlanUpdated(e: Event) {
      const detail = (e as CustomEvent).detail as WeeklyPlanView | null;
      if (detail?.weekStart && Array.isArray(detail.days)) {
        setCalendarWeeks((prev) =>
          prev
            ? prev.map((week) =>
                week.weekStart === detail.weekStart ? detail : week,
              )
            : prev,
        );
        setView((current) =>
          current && current.weekStart === detail.weekStart ? detail : current,
        );
        setBriefByDate((prev) => {
          const next = { ...prev };
          for (const day of detail.days) delete next[day.date];
          return next;
        });
        if (sheetOpen) void loadCalendar();
        return;
      }
      void load();
      if (sheetOpen) void loadCalendar();
    }
    window.addEventListener("turnova:strava-synced", onStravaSynced);
    window.addEventListener("turnova:plan-updated", onPlanUpdated);
    return () => {
      window.removeEventListener("turnova:strava-synced", onStravaSynced);
      window.removeEventListener("turnova:plan-updated", onPlanUpdated);
    };
  }, [load, loadCalendar, sheetOpen]);

  useEffect(() => {
    if (!sheetOpen) return;
    void loadCalendar();
  }, [sheetOpen, loadCalendar]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (selectedDay) {
        setSelectedDay(null);
        return;
      }
      if (sheetOpen) setSheetOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen, selectedDay]);

  const selectedDate = selectedDay?.date ?? null;
  const cachedBrief = selectedDate ? briefByDate[selectedDate] : undefined;

  useEffect(() => {
    if (!selectedDate) return;
    if (cachedBrief) {
      setBriefText(cachedBrief.brief);
      setNutrition(cachedBrief.nutrition);
      setBriefLoading(false);
      setBriefError(null);
      return;
    }
    const ac = new AbortController();
    setBriefText("");
    setNutrition([]);
    setBriefError(null);
    setBriefLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/plan/day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: selectedDate }),
          signal: ac.signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          brief?: string;
          nutrition?: DayNutrition[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `Brief failed (${res.status})`);
        }
        if (ac.signal.aborted) return;
        const cleaned = toConversationalPlainText(data.brief ?? "");
        const lines = (data.nutrition ?? [])
          .map((item) => ({
            name: item.name.trim(),
            notes: toConversationalPlainText(item.notes ?? ""),
          }))
          .filter((item) => item.name && item.notes);
        setBriefText(cleaned);
        setNutrition(lines);
        setBriefByDate((prev) => ({
          ...prev,
          [selectedDate]: { brief: cleaned, nutrition: lines },
        }));
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setBriefError(e instanceof Error ? e.message : "Brief failed");
      } finally {
        if (!ac.signal.aborted) setBriefLoading(false);
      }
    })();
    return () => ac.abort();
  }, [selectedDate, cachedBrief]);

  function mergeGeneratedWeek(body: WeeklyPlanView) {
    setCalendarWeeks((prev) =>
      prev
        ? prev.map((week) =>
            week.weekStart === body.weekStart ? body : week,
          )
        : prev,
    );
    setView((current) =>
      current && current.weekStart === body.weekStart ? body : current,
    );
    setBriefByDate((prev) => {
      const next = { ...prev };
      for (const day of body.days) delete next[day.date];
      return next;
    });
  }

  async function generate(weekStart?: string) {
    const target = weekStart ?? view?.weekStart;
    if (weekStart) setGeneratingWeek(weekStart);
    else setGenerating(true);
    setError(null);
    setCalendarError(null);
    try {
      const body = (await postWeeklyPlanGenerate({
        weekStart: target,
        chatGuidance: readRecentChatGuidance() || undefined,
      })) as WeeklyPlanView;
      mergeGeneratedWeek(body);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generate failed";
      if (weekStart) setCalendarError(message);
      else setError(message);
    } finally {
      setGenerating(false);
      setGeneratingWeek(null);
    }
  }

  const hasPlan = Boolean(view?.plan);
  const cardProps: Omit<PlanCardProps, "onClose" | "className"> = {
    view,
    error,
    loading,
    generating,
    hasPlan,
    onGenerate: () => void generate(),
    onLookAhead: () => setSheetOpen(true),
    onSelectDay: setSelectedDay,
    expanded: cardExpanded,
    onToggleExpanded: () => setCardExpanded((open) => !open),
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-block h-auto min-h-0 justify-between gap-3 border border-base-300 py-2.5 sm:hidden"
        aria-expanded={sheetOpen}
        aria-haspopup="dialog"
        onClick={() => setSheetOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-2 truncate text-left">
          <span className="font-display truncate text-sm font-semibold">
            {weekHeadingText(view, loading)}
          </span>
          <WeekIntentBadges plan={view?.plan ?? null} />
        </span>
        <span className="shrink-0 text-sm text-base-content/70">View</span>
      </button>

      <div className="hidden sm:block">
        <PlanCard {...cardProps} />
      </div>

      {sheetOpen ? (
        <div className="modal modal-open modal-bottom sm:modal-middle">
          <button
            type="button"
            className="modal-backdrop bg-neutral/40"
            aria-label="Close look-ahead calendar"
            onClick={() => setSheetOpen(false)}
          />
          <div
            className="modal-box m-0 flex max-h-[85dvh] w-full max-w-none flex-col overflow-hidden p-0 sm:max-w-xl"
            role="dialog"
            aria-labelledby="week-plan-sheet-title"
            style={{
              paddingBottom: "max(0px, env(safe-area-inset-bottom))",
            }}
          >
            <PlanCalendar
              weeks={calendarWeeks}
              today={calendarToday}
              currentMonday={view?.weekStart ?? null}
              loading={calendarLoading}
              error={calendarError}
              generatingWeek={generatingWeek}
              onGenerateWeek={(weekStart) => void generate(weekStart)}
              onSelectDay={setSelectedDay}
              onClose={() => setSheetOpen(false)}
            />
          </div>
        </div>
      ) : null}

      {selectedDay ? (
        <DayBriefSheet
          day={selectedDay}
          brief={briefText}
          nutrition={nutrition}
          loading={briefLoading}
          error={briefError}
          onClose={() => setSelectedDay(null)}
        />
      ) : null}
    </>
  );
}
