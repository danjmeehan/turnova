/**
 * Monday-start training weeks and NY-local calendar dates.
 * Date-only keys (YYYY-MM-DD) are civil dates, independent of server TZ.
 */

export const ATHLETE_TIMEZONE = "America/New_York";

export const WEEKDAYS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

const UTC_WEEKDAY_TO_LABEL = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

function parseDateKey(dateKey: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  return {
    y: Number(match[1]),
    m: Number(match[2]),
    d: Number(match[3]),
  };
}

/** Store date-only keys as UTC midnight, matching DailyTelemetry. */
export function toDateOnly(dateKey: string): Date {
  parseDateKey(dateKey);
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateKey: string, days: number): string {
  const { y, m, d } = parseDateKey(dateKey);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

export function weekdayLabel(dateKey: string): Weekday {
  const { y, m, d } = parseDateKey(dateKey);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const label = UTC_WEEKDAY_TO_LABEL[utcNoon.getUTCDay()];
  if (label === "Sun") return "Sun";
  return label as Weekday;
}

/** Monday of the ISO-style week containing this civil date. */
export function mondayOfWeek(dateKey: string): string {
  const { y, m, d } = parseDateKey(dateKey);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offset = (utcNoon.getUTCDay() + 6) % 7;
  return addDays(dateKey, -offset);
}

export function weekDateKeys(mondayKey: string): string[] {
  const monday = mondayOfWeek(mondayKey);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function calendarDateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !month || !d) {
    throw new Error("Failed to format calendar date");
  }
  return `${y}-${month}-${d}`;
}

export function todayDateKey(
  timeZone: string = ATHLETE_TIMEZONE,
  now: Date = new Date(),
): string {
  return calendarDateInZone(now, timeZone);
}

export function currentMondayKey(
  timeZone: string = ATHLETE_TIMEZONE,
  now: Date = new Date(),
): string {
  return mondayOfWeek(todayDateKey(timeZone, now));
}

/**
 * Strava timezone strings look like "(GMT-05:00) America/New_York".
 * Fall back to the athlete zone when missing or unparseable.
 */
export function parseStravaTimezone(
  raw: string | null | undefined,
): string {
  if (!raw) return ATHLETE_TIMEZONE;
  const iana = raw.match(/([A-Za-z]+(?:_[A-Za-z]+)?\/[A-Za-z]+(?:_[A-Za-z]+)?)/);
  if (iana?.[1]) return iana[1];
  return ATHLETE_TIMEZONE;
}

export function activityDateKey(
  startDate: Date,
  timezone: string | null | undefined,
): string {
  return calendarDateInZone(startDate, parseStravaTimezone(timezone));
}

/** Whole weeks from this Monday to the Monday of the race week (0 = race week). */
export function weeksOutFromRace(
  weekStartKey: string,
  raceDateKey: string | null | undefined,
): number | null {
  if (!raceDateKey || !/^\d{4}-\d{2}-\d{2}$/.test(raceDateKey)) return null;
  const raceMonday = mondayOfWeek(raceDateKey);
  const { y: y1, m: m1, d: d1 } = parseDateKey(mondayOfWeek(weekStartKey));
  const { y: y2, m: m2, d: d2 } = parseDateKey(raceMonday);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / (7 * 24 * 60 * 60 * 1000));
}

export function compareDateKeys(a: string, b: string): number {
  return a.localeCompare(b);
}
