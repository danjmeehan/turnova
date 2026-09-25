export type RaceSearchHit = {
  raceId: number;
  eventId: number;
  name: string;
  eventName: string;
  date: string;
  distance: string;
  city: string;
  url: string;
};

export const SEARCH_EVENT_TYPES = [
  "running_race",
  "running_only",
  "trail_race",
  "ultra",
  "open_course_trail",
] as const;

export type SearchEventType = (typeof SEARCH_EVENT_TYPES)[number];

export const RACE_SEARCH_TYPE_OPTIONS: {
  id: SearchEventType;
  label: string;
}[] = [
  { id: "running_race", label: "Road race" },
  { id: "running_only", label: "Club" },
  { id: "trail_race", label: "Trail" },
  { id: "ultra", label: "Ultra" },
  { id: "open_course_trail", label: "Open course trail" },
];

export type RaceSearchSettings = {
  radius_miles: number;
  window_months: number;
  event_types: SearchEventType[];
};

export const DEFAULT_RACE_SEARCH: RaceSearchSettings = {
  radius_miles: 50,
  window_months: 3,
  event_types: [...SEARCH_EVENT_TYPES],
};

export function isSearchEventType(value: string): value is SearchEventType {
  return (SEARCH_EVENT_TYPES as readonly string[]).includes(value);
}
