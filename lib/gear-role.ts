export const GEAR_ROLES = [
  "Daily / Recovery",
  "Quality / Workouts",
  "Race",
  "Trails",
] as const;

export type GearRole = (typeof GEAR_ROLES)[number];

export function isGearRole(value: string): value is GearRole {
  return (GEAR_ROLES as readonly string[]).includes(value);
}

export function normalizeGearRole(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (isGearRole(raw)) return raw;
  const key = raw.toLowerCase().replace(/\s+/g, " ");
  if (key === "active") return "";
  if (key.includes("trail")) return "Trails";
  if (key.includes("race")) return "Race";
  if (key.includes("quality") || key.includes("workout")) {
    return "Quality / Workouts";
  }
  if (key.includes("daily") || key.includes("recovery")) {
    return "Daily / Recovery";
  }
  return "";
}
