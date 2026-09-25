import { addDays, todayDateKey } from "@/lib/week";
import {
  DEFAULT_RACE_SEARCH,
  SEARCH_EVENT_TYPES,
  isSearchEventType,
  type RaceSearchHit,
} from "@/lib/race-search";

export type { RaceSearchHit } from "@/lib/race-search";
export { SEARCH_EVENT_TYPES } from "@/lib/race-search";

export const DEFAULT_RACE_ZIP = "12533";
export const SEARCH_RADIUS_MILES = DEFAULT_RACE_SEARCH.radius_miles;
export const SEARCH_WINDOW_DAYS = DEFAULT_RACE_SEARCH.window_months * 30;

export function zipFromLocation(location: string | undefined): string {
  const match = location?.match(/\b\d{5}\b/);
  return match?.[0] ?? DEFAULT_RACE_ZIP;
}

function flagTrue(value: unknown): boolean {
  return value === true || value === "T" || value === "t" || value === 1;
}

function parseRunsignupDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw.trim());
  if (!us) return null;
  return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function normalizeDistance(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (
    /^13\.1\s*(miles?|mi\.?)?$/.test(lower) ||
    lower.includes("half marathon")
  ) {
    return "Half Marathon";
  }
  if (
    /^26\.2\s*(miles?|mi\.?)?$/.test(lower) ||
    (lower === "marathon" && !lower.includes("half"))
  ) {
    return "Marathon";
  }
  return value;
}

type RunsignupEvent = {
  event_id?: number;
  name?: string;
  distance?: string | null;
  start_time?: string | null;
  volunteer?: string | boolean;
  event_type?: string;
};

type RunsignupRace = {
  race_id?: number;
  name?: string;
  next_date?: string | null;
  is_draft_race?: string | boolean;
  is_private_race?: string | boolean;
  url?: string | null;
  address?: { city?: string | null; state?: string | null };
  events?: RunsignupEvent[];
};

const ALLOWED_EVENT_TYPES = new Set<string>(SEARCH_EVENT_TYPES);

function authParams(): URLSearchParams {
  const params = new URLSearchParams();
  const key = process.env.RUNSIGNUP_API_KEY?.trim();
  const secret = process.env.RUNSIGNUP_API_SECRET?.trim();
  if (key) params.set("api_key", key);
  if (secret) params.set("api_secret", secret);
  return params;
}

function mapRaces(
  items: Array<{ race?: RunsignupRace } | RunsignupRace> | undefined,
): RaceSearchHit[] {
  const hits: RaceSearchHit[] = [];
  for (const item of items ?? []) {
    const race =
      item && typeof item === "object" && "race" in item
        ? (item.race ?? {})
        : (item as RunsignupRace);
    if (flagTrue(race.is_draft_race) || flagTrue(race.is_private_race)) continue;
    const raceId = Number(race.race_id);
    if (!Number.isFinite(raceId) || !race.name) continue;
    const cityParts = [race.address?.city, race.address?.state].filter(Boolean);
    const city = cityParts.join(", ");
    const fallbackDate = parseRunsignupDate(race.next_date);
    for (const event of race.events ?? []) {
      if (flagTrue(event.volunteer)) continue;
      if (event.event_type && !ALLOWED_EVENT_TYPES.has(event.event_type)) {
        continue;
      }
      const eventId = Number(event.event_id);
      if (!Number.isFinite(eventId)) continue;
      const distance = normalizeDistance(event.distance);
      if (!distance) continue;
      const date = parseRunsignupDate(event.start_time) ?? fallbackDate;
      if (!date) continue;
      hits.push({
        raceId,
        eventId,
        name: race.name,
        eventName: event.name?.trim() || distance,
        date,
        distance,
        city,
        url: race.url?.trim() || "",
      });
    }
  }
  return hits;
}

async function fetchRacesForType(options: {
  zip: string;
  name?: string;
  eventType: string;
  start: string;
  end: string;
  radius: number;
}): Promise<RaceSearchHit[]> {
  const params = authParams();
  params.set("format", "json");
  params.set("events", "T");
  params.set("event_type", options.eventType);
  params.set("start_date", options.start);
  params.set("end_date", options.end);
  params.set("search_start_date_only", "T");
  params.set("zipcode", options.zip);
  params.set("radius", String(options.radius));
  params.set("results_per_page", "25");
  params.set("sort", "date ASC");
  if (options.name) params.set("name", options.name);

  const url = `https://api.runsignup.com/rest/races?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Turnova/1.0" },
    cache: "no-store",
  });
  const raw = (await res.json()) as {
    error?: { error_msg?: string };
    races?: Array<{ race?: RunsignupRace } | RunsignupRace>;
  };
  if (!res.ok || raw.error) {
    throw new Error(
      raw.error?.error_msg || `RunSignup search failed (${res.status})`,
    );
  }
  return mapRaces(raw.races);
}

export function resolveRaceSearch(options?: {
  radius?: number;
  windowMonths?: number;
  eventTypes?: string[];
}): { radius: number; windowDays: number; eventTypes: string[] } {
  const radiusRaw = options?.radius ?? SEARCH_RADIUS_MILES;
  const monthsRaw = options?.windowMonths ?? DEFAULT_RACE_SEARCH.window_months;
  const radius = Math.min(250, Math.max(1, Math.round(radiusRaw) || SEARCH_RADIUS_MILES));
  const months = Math.min(24, Math.max(1, Math.round(monthsRaw) || DEFAULT_RACE_SEARCH.window_months));
  const requested = (options?.eventTypes ?? []).filter(isSearchEventType);
  const eventTypes =
    requested.length > 0 ? requested : [...SEARCH_EVENT_TYPES];
  return { radius, windowDays: months * 30, eventTypes };
}

export async function searchRunsignupRaces(options: {
  zip: string;
  name?: string;
  radius?: number;
  windowMonths?: number;
  eventTypes?: string[];
}): Promise<RaceSearchHit[]> {
  const { radius, windowDays, eventTypes } = resolveRaceSearch(options);
  const start = todayDateKey();
  const end = addDays(start, windowDays);
  const name = options.name?.trim() || undefined;
  const batches = await Promise.all(
    eventTypes.map((eventType) =>
      fetchRacesForType({
        zip: options.zip,
        name,
        eventType,
        start,
        end,
        radius,
      }),
    ),
  );
  const seen = new Set<string>();
  const hits: RaceSearchHit[] = [];
  for (const hit of batches.flat()) {
    const key = `${hit.raceId}:${hit.eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
  }
  hits.sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
  return hits;
}
