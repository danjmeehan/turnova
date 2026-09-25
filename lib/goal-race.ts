import { z } from "zod";
import { mondayOfWeek, todayDateKey, weeksOutFromRace } from "@/lib/week";

export const GOAL_RACE_STATUS_LABELS: Record<string, string> = {
  planning: "Planning",
  training: "Training",
  taper: "Taper",
  complete: "Complete",
};

export function goalRaceStatusBadgeClass(status: string): string {
  if (status === "training") return "badge-success";
  if (status === "taper") return "badge-warning";
  if (status === "complete") return "badge-neutral";
  return "badge-outline";
}

export const goalRaceSchema = z.object({
  id: z.string().default(""),
  name: z.string().default(""),
  date: z.string().default(""),
  distance: z.string().default(""),
  location: z.string().default(""),
  goal_time: z.string().default(""),
  priority: z.string().default("A"),
  status: z.string().default("planning"),
  /** Shared planning notes — athlete and coach collaborate here via chat + edits. */
  notes: z.string().default(""),
  primary: z.boolean().default(false),
  source: z.enum(["manual", "runsignup"]).default("manual"),
  runsignup_race_id: z.number().optional(),
  runsignup_event_id: z.number().optional(),
  url: z.string().default(""),
});

export type GoalRace = z.infer<typeof goalRaceSchema>;

export function newGoalRaceId(): string {
  return crypto.randomUUID();
}

export function emptyGoalRace(primary = false): GoalRace {
  return {
    id: newGoalRaceId(),
    name: "",
    date: "",
    distance: "",
    location: "",
    goal_time: "",
    priority: "A",
    status: "planning",
    notes: "",
    primary,
    source: "manual",
    url: "",
  };
}

export function computeGoalRaceStatus(
  date: string,
  today: string = todayDateKey(),
): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "planning";
  if (date < today) return "complete";
  const weeksOut = weeksOutFromRace(mondayOfWeek(today), date);
  if (weeksOut !== null && weeksOut <= 1) return "taper";
  return "training";
}

export function primaryGoalRace(
  races: GoalRace[] | { goal_races?: GoalRace[] },
): GoalRace {
  const list = Array.isArray(races) ? races : (races.goal_races ?? []);
  return list.find((race) => race.primary) ?? list[0] ?? emptyGoalRace(true);
}

export function syncGoalRaces(races: GoalRace[]): {
  goal_races: GoalRace[];
  goal_race: GoalRace;
} {
  const list = races.map((race) => ({
    ...race,
    id: race.id || newGoalRaceId(),
    status: computeGoalRaceStatus(race.date),
  }));
  if (list.length === 0) {
    return { goal_races: [], goal_race: emptyGoalRace(true) };
  }
  const keep = list.findIndex((race) => race.primary);
  const primaryIndex = keep >= 0 ? keep : 0;
  const goal_races = list.map((race, index) => ({
    ...race,
    primary: index === primaryIndex,
  }));
  return { goal_races, goal_race: goal_races[primaryIndex]! };
}

/** If an older profile only has `goal_race`, wrap it as the primary list row. */
export function migrateGoalRacesInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  const existing = Array.isArray(obj.goal_races) ? obj.goal_races : [];
  if (existing.length > 0) return obj;
  if (obj.goal_race && typeof obj.goal_race === "object") {
    return {
      ...obj,
      goal_races: [{ ...(obj.goal_race as object), primary: true }],
    };
  }
  return obj;
}
