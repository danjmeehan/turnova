/**
 * WeatherAPI.com current + forecast for coaching context.
 * Soft-fails: missing key/location or API errors return null (chat still works).
 */

import { loadAthleteProfile } from "@/lib/athlete-profile";
import { getWeatherApiKey } from "@/lib/env";

const FORECAST_URL = "https://api.weatherapi.com/v1/forecast.json";
const CACHE_TTL_MS = 15 * 60 * 1000;
const DAY_ATTEMPTS = [14, 7, 3] as const;
const SNAPSHOT_HOURS = [7, 12, 17] as const;

export type CompactWeatherHour = {
  time: string;
  tempF: number;
  precipChance: number;
  windMph: number;
  condition: string;
};

export type WeatherIconKind =
  | "sun"
  | "partly"
  | "cloud"
  | "fog"
  | "rain"
  | "storm"
  | "snow";

export type DayWeatherChip = {
  icon: WeatherIconKind;
  highF: number;
  lowF: number;
  condition: string;
};

export type CompactWeatherDay = {
  date: string;
  highF: number;
  lowF: number;
  rainChance: number;
  snowChance: number;
  maxWindMph: number;
  condition: string;
  code: number;
};

export type CompactWeather = {
  place: string;
  localTime: string;
  forecastDays: number;
  lastForecastDate: string | null;
  now: {
    tempF: number;
    feelsLikeF: number;
    humidity: number;
    precipIn: number;
    windMph: number;
    gustMph: number;
    condition: string;
  };
  days: CompactWeatherDay[];
  hourlyTodayTomorrow: {
    today: CompactWeatherHour[];
    tomorrow: CompactWeatherHour[];
  };
  alerts: string[];
};

type CacheEntry = {
  expires: number;
  value: CompactWeather | null;
};

const cache = new Map<string, CacheEntry>();

type ApiCondition = { text?: string; code?: number };
type ApiHour = {
  time?: string;
  temp_f?: number;
  chance_of_rain?: number;
  wind_mph?: number;
  condition?: ApiCondition;
};
type ApiForecastDay = {
  date?: string;
  day?: {
    maxtemp_f?: number;
    mintemp_f?: number;
    daily_chance_of_rain?: number;
    daily_chance_of_snow?: number;
    maxwind_mph?: number;
    condition?: ApiCondition;
  };
  hour?: ApiHour[];
};
type ApiAlert = { headline?: string; event?: string };
type WeatherApiResponse = {
  error?: { code?: number; message?: string };
  location?: {
    name?: string;
    region?: string;
    country?: string;
    localtime?: string;
  };
  current?: {
    temp_f?: number;
    feelslike_f?: number;
    humidity?: number;
    precip_in?: number;
    wind_mph?: number;
    gust_mph?: number;
    condition?: ApiCondition;
  };
  forecast?: { forecastday?: ApiForecastDay[] };
  alerts?: { alert?: ApiAlert[] };
};

function cacheKey(location: string): string {
  return location.trim().toLowerCase();
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hourFromTime(time: string | undefined): number | null {
  if (!time || time.length < 13) return null;
  const hh = Number(time.slice(11, 13));
  return Number.isFinite(hh) ? hh : null;
}

function snapshots(hours: ApiHour[] | undefined): CompactWeatherHour[] {
  if (!hours?.length) return [];
  const out: CompactWeatherHour[] = [];
  for (const want of SNAPSHOT_HOURS) {
    const row = hours.find((h) => hourFromTime(h.time) === want);
    if (!row) continue;
    out.push({
      time: `${String(want).padStart(2, "0")}:00`,
      tempF: Math.round(num(row.temp_f)),
      precipChance: num(row.chance_of_rain),
      windMph: Math.round(num(row.wind_mph)),
      condition: row.condition?.text?.trim() || "unknown",
    });
  }
  return out;
}

function compactFromApi(data: WeatherApiResponse): CompactWeather | null {
  const loc = data.location;
  const current = data.current;
  const forecastDays = data.forecast?.forecastday ?? [];
  if (!loc?.name || !current) return null;

  const days: CompactWeatherDay[] = forecastDays
    .filter((d) => d.date)
    .map((d) => ({
      date: d.date as string,
      highF: Math.round(num(d.day?.maxtemp_f)),
      lowF: Math.round(num(d.day?.mintemp_f)),
      rainChance: num(d.day?.daily_chance_of_rain),
      snowChance: num(d.day?.daily_chance_of_snow),
      maxWindMph: Math.round(num(d.day?.maxwind_mph)),
      condition: d.day?.condition?.text?.trim() || "unknown",
      code: num(d.day?.condition?.code),
    }));

  const placeParts = [loc.name, loc.region].filter(Boolean);
  const lastForecastDate = days.at(-1)?.date ?? null;

  return {
    place: placeParts.join(", ") || loc.name,
    localTime: loc.localtime ?? "",
    forecastDays: days.length,
    lastForecastDate,
    now: {
      tempF: Math.round(num(current.temp_f)),
      feelsLikeF: Math.round(num(current.feelslike_f)),
      humidity: num(current.humidity),
      precipIn: num(current.precip_in),
      windMph: Math.round(num(current.wind_mph)),
      gustMph: Math.round(num(current.gust_mph)),
      condition: current.condition?.text?.trim() || "unknown",
    },
    days,
    hourlyTodayTomorrow: {
      today: snapshots(forecastDays[0]?.hour),
      tomorrow: snapshots(forecastDays[1]?.hour),
    },
    alerts: (data.alerts?.alert ?? [])
      .map((a) => a.headline?.trim() || a.event?.trim() || "")
      .filter(Boolean)
      .slice(0, 8),
  };
}

function shouldRetryShorterHorizon(
  daysRequested: number,
  status: number,
  data: WeatherApiResponse,
): boolean {
  if (daysRequested <= 3) return false;
  if (data.forecast?.forecastday?.length) return false;
  const code = data.error?.code;
  if (code === 1006 || code === 2006 || code === 2007 || code === 2008) {
    return false;
  }
  const msg = (data.error?.message ?? "").toLowerCase();
  if (
    msg.includes("day") ||
    msg.includes("forecast") ||
    msg.includes("plan") ||
    msg.includes("upgrade")
  ) {
    return true;
  }
  return status === 400 || status === 403 || Boolean(data.error);
}

async function fetchForecast(
  key: string,
  location: string,
  days: number,
): Promise<{ status: number; data: WeatherApiResponse }> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("q", location);
  url.searchParams.set("days", String(days));
  url.searchParams.set("aqi", "no");
  url.searchParams.set("alerts", "yes");

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  let data: WeatherApiResponse = {};
  try {
    data = (await res.json()) as WeatherApiResponse;
  } catch {
    data = { error: { message: "invalid JSON from WeatherAPI" } };
  }
  return { status: res.status, data };
}

/**
 * Compact forecast for the model, or null if unavailable.
 */
export async function getWeatherContext(
  location: string | undefined,
): Promise<CompactWeather | null> {
  const q = location?.trim() ?? "";
  const key = getWeatherApiKey();
  if (!q || !key) return null;

  const ck = cacheKey(q);
  const hit = cache.get(ck);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value: CompactWeather | null = null;
  try {
    for (const days of DAY_ATTEMPTS) {
      const { status, data } = await fetchForecast(key, q, days);
      const compact = compactFromApi(data);
      if (compact) {
        value = compact;
        break;
      }
      if (!shouldRetryShorterHorizon(days, status, data)) {
        console.error(
          "[weather] fetch failed",
          status,
          data.error?.code ?? "",
          data.error?.message ?? "",
        );
        break;
      }
    }
  } catch (err) {
    console.error("[weather] fetch", err);
    value = null;
  }

  cache.set(ck, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

/** Map WeatherAPI condition codes to a small icon set. */
export function weatherIconFromCode(code: number): WeatherIconKind {
  if (code === 1000) return "sun";
  if (code === 1003) return "partly";
  if (code === 1006 || code === 1009) return "cloud";
  if (code === 1030 || code === 1135 || code === 1147) return "fog";
  if (code === 1087 || (code >= 1273 && code <= 1282)) return "storm";
  if (
    code === 1066 ||
    code === 1114 ||
    code === 1117 ||
    (code >= 1210 && code <= 1225) ||
    (code >= 1255 && code <= 1264)
  ) {
    return "snow";
  }
  if (
    code === 1063 ||
    code === 1069 ||
    code === 1072 ||
    (code >= 1150 && code <= 1207) ||
    code === 1237 ||
    (code >= 1240 && code <= 1252)
  ) {
    return "rain";
  }
  return "cloud";
}

export function dayWeatherChip(day: CompactWeatherDay): DayWeatherChip {
  return {
    icon: weatherIconFromCode(day.code),
    highF: day.highF,
    lowF: day.lowF,
    condition: day.condition,
  };
}

function applyWeatherMap<
  T extends { days: ReadonlyArray<{ date: string }> },
>(
  view: T,
  byDate: Map<string, DayWeatherChip>,
): Omit<T, "days"> & {
  days: Array<T["days"][number] & { weather: DayWeatherChip | null }>;
} {
  return {
    ...view,
    days: view.days.map((d) => ({
      ...d,
      weather: byDate.get(d.date) ?? null,
    })),
  };
}

async function weatherChipMap(): Promise<Map<string, DayWeatherChip>> {
  const profile = loadAthleteProfile();
  const weather = await getWeatherContext(profile.location);
  return new Map(
    (weather?.days ?? []).map((d) => [d.date, dayWeatherChip(d)]),
  );
}

/**
 * Overlay live forecast onto a weekly plan view for the UI only.
 * Days outside the forecast horizon get weather: null.
 */
export async function attachPlanWeather<
  T extends { days: ReadonlyArray<{ date: string }> },
>(view: T): Promise<
  Omit<T, "days"> & {
    days: Array<T["days"][number] & { weather: DayWeatherChip | null }>;
  }
> {
  const byDate = await weatherChipMap();
  return applyWeatherMap(view, byDate);
}

export async function attachPlanWeatherMany<
  T extends { days: ReadonlyArray<{ date: string }> },
>(
  views: T[],
): Promise<
  Array<
    Omit<T, "days"> & {
      days: Array<T["days"][number] & { weather: DayWeatherChip | null }>;
    }
  >
> {
  const byDate = await weatherChipMap();
  return views.map((view) => applyWeatherMap(view, byDate));
}

export function weatherPromptSection(weather: CompactWeather | null): string {
  if (!weather) {
    return "(no weather — missing location, WEATHERAPI_KEY, or forecast unavailable)";
  }
  const horizon = weather.lastForecastDate
    ? `Do not invent weather after ${weather.lastForecastDate}.`
    : "Do not invent weather beyond this block.";
  return JSON.stringify(
    {
      note: `Observed/forecast from WeatherAPI for ${weather.place}. ${horizon}`,
      ...weather,
    },
    null,
    2,
  );
}
