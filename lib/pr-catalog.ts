export const PR_EVENT_NAMES = [
  "200m",
  "400m",
  "800m",
  "1000m",
  "1500m",
  "Mile",
  "3000m",
  "3200m",
  "5K",
  "8K",
  "10K",
  "Half Marathon",
  "Marathon",
] as const;

export type PrEventName = (typeof PR_EVENT_NAMES)[number];

export const PR_PERIODS = [
  "High School",
  "College",
  "Post-Collegiate",
  "Masters",
] as const;

export type PrPeriod = (typeof PR_PERIODS)[number];

export function isPrEventName(value: string): value is PrEventName {
  return (PR_EVENT_NAMES as readonly string[]).includes(value);
}

export function isPrPeriod(value: string): value is PrPeriod {
  return (PR_PERIODS as readonly string[]).includes(value);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

const EVENT_ALIASES: Record<string, PrEventName> = {
  "200": "200m",
  "400": "400m",
  "800": "800m",
  "1000": "1000m",
  "1500": "1500m",
  "3000": "3000m",
  "3200": "3200m",
  "5000m": "5K",
  "5k": "5K",
  "5 km": "5K",
  "8000m": "8K",
  "8k": "8K",
  "8 km": "8K",
  "10000m": "10K",
  "10k": "10K",
  "10 km": "10K",
  half: "Half Marathon",
  "half marathon": "Half Marathon",
  mile: "Mile",
  "1 mile": "Mile",
};

export function mapPrEventName(event: string, distance: string): PrEventName | "" {
  const candidates = [distance, event].map(normalize).filter(Boolean);
  for (const candidate of candidates) {
    if (EVENT_ALIASES[candidate]) return EVENT_ALIASES[candidate];
    for (const option of PR_EVENT_NAMES) {
      if (normalize(option) === candidate) return option;
    }
  }
  const hay = normalize(`${event} ${distance}`);
  const sorted = [...PR_EVENT_NAMES].sort((a, b) => b.length - a.length);
  for (const option of sorted) {
    const token = normalize(option).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\s)${token}(?:\\s|$)`, "i");
    if (re.test(hay)) return option;
  }
  return "";
}

export function inferPrPeriod(event: string, notes: string): PrPeriod | "" {
  const blob = `${event} ${notes}`.toLowerCase();
  if (/\b(high school|hs|prep)\b/.test(blob)) return "High School";
  if (/\b(collegiate|college|ncaa)\b/.test(blob)) return "College";
  if (/\bmasters\b/.test(blob)) return "Masters";
  if (/\bpost[- ]collegiate\b/.test(blob)) return "Post-Collegiate";
  return "";
}
