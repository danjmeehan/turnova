export const DISTANCE_FOCUS_OPTIONS = [
  "5k",
  "10K",
  "Half Marathon",
  "Marathon",
] as const;

export type DistanceFocus = (typeof DISTANCE_FOCUS_OPTIONS)[number];

export function isDistanceFocus(value: string): value is DistanceFocus {
  return (DISTANCE_FOCUS_OPTIONS as readonly string[]).includes(value);
}
