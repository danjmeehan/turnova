/**
 * Athlete profile file store (FR-001).
 * Default: data/athlete_profile.json. When DATA_DIR is set (Fly volume),
 * the writable copy is $DATA_DIR/athlete_profile.json (seeded from the bundle).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  emptyGoalRace,
  goalRaceSchema,
  migrateGoalRacesInput,
  syncGoalRaces,
} from "@/lib/goal-race";
import { normalizeGearRole } from "@/lib/gear-role";
import {
  DEFAULT_RACE_SEARCH,
  SEARCH_EVENT_TYPES,
  isSearchEventType,
} from "@/lib/race-search";
import {
  DISTANCE_FOCUS_OPTIONS,
  isDistanceFocus,
  type DistanceFocus,
} from "@/lib/distance-focus";
import {
  EXPERIENCE_LEVELS,
  inferExperience,
  isExperienceLevel,
  leftoverExperienceNotes,
} from "@/lib/experience";
import {
  inferPrPeriod,
  isPrEventName,
  isPrPeriod,
  mapPrEventName,
  PR_EVENT_NAMES,
  PR_PERIODS,
} from "@/lib/pr-catalog";

export { DISTANCE_FOCUS_OPTIONS, isDistanceFocus } from "@/lib/distance-focus";
export type { DistanceFocus } from "@/lib/distance-focus";
export { EXPERIENCE_LEVELS } from "@/lib/experience";
export type { ExperienceLevel } from "@/lib/experience";
export { PR_EVENT_NAMES, PR_PERIODS } from "@/lib/pr-catalog";
export type { PrEventName, PrPeriod } from "@/lib/pr-catalog";

export { GEAR_ROLES, isGearRole, normalizeGearRole } from "@/lib/gear-role";
export type { GearRole } from "@/lib/gear-role";

export {
  emptyGoalRace,
  primaryGoalRace,
  computeGoalRaceStatus,
  GOAL_RACE_STATUS_LABELS,
} from "@/lib/goal-race";
export type { GoalRace } from "@/lib/goal-race";

const zoneSchema = z.object({
  description: z.string(),
});

const prEventNameSchema = z.union([z.literal(""), z.enum(PR_EVENT_NAMES)]);
const prPeriodSchema = z.union([z.literal(""), z.enum(PR_PERIODS)]);

const prEventSchema = z.object({
  event: prEventNameSchema.default(""),
  period: prPeriodSchema.default(""),
  time: z.string(),
  notes: z.string().default(""),
});

const shoeSchema = z.object({
  uuid: z.string().default(""),
  status: z.string().default("").transform(normalizeGearRole),
  notes: z.string().default(""),
  /** Legacy catalog name; kept so first Garmin sync can match overlay notes. */
  name: z.string().optional(),
  nickname: z.string().optional(),
});

export const emptyShoe = (): z.infer<typeof shoeSchema> => ({
  uuid: "",
  status: "",
  notes: "",
});

const pantryItemSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
});

/** Used only when an older profile has no pantry key. An empty array is kept. */
const SEED_PANTRY: z.infer<typeof pantryItemSchema>[] = [
  {
    name: "Vital Proteins Collagen Peptides",
    description:
      "Muscle tissue has a rich vascular network, so when you drink a whey shake after a workout, blood immediately rushes amino acids into your muscles. Tendons and ligaments are largely avascular—they have virtually no direct blood flow. They receive nutrients through passive diffusion. When you run or perform calf raises, your tendons act like sponges: mechanical tension squeezes fluid out, and when you relax, it draws fluid and dissolved nutrients back in. The catch is the timing. Taking collagen after a workout—the way you take whey protein—does almost nothing for your tendons because the mechanical pumping action has already stopped.",
  },
  {
    name: "Momentous Whey Protein Isolate",
    description:
      "Knocking back twenty-five to thirty grams of high-leucine whey isolate within forty-five minutes of finishing your runs and strength sessions is critical for repairing muscle damage, stimulating muscle tone, and accelerating collagen repair.",
  },
  {
    name: "Skratch Labs Hydration Sport Mix",
    description:
      "A hydration mix serves two very specific physiological purposes: restoring sodium lost in sweat to maintain blood plasma volume, and providing a steady trickle of easily digestible carbohydrates to spare muscle glycogen. Used for: threshold days, long runs, and extreme heat/humidity.",
  },
];

const gearSchema = z.object({
  note: z.string().default(""),
  shoes: z.array(shoeSchema).default([]),
});

const raceSearchSchema = z.object({
  radius_miles: z.coerce.number().int().min(1).max(250).default(50),
  window_months: z.coerce.number().int().min(1).max(24).default(3),
  event_types: z
    .array(z.string())
    .default([...SEARCH_EVENT_TYPES])
    .transform((types) => {
      const allowed = types.filter(isSearchEventType);
      return allowed.length > 0 ? allowed : [...SEARCH_EVENT_TYPES];
    }),
});

export const DEFAULT_LOCATION = "Hopewell Junction, NY 12533";

function migrateRaceTarget(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  const raw = obj.race_target;
  let selected: DistanceFocus[] = [];
  if (Array.isArray(raw)) {
    selected = raw.filter(
      (value): value is DistanceFocus =>
        typeof value === "string" && isDistanceFocus(value),
    );
  } else if (typeof raw === "string" && isDistanceFocus(raw.trim())) {
    selected = [raw.trim() as DistanceFocus];
  }
  return {
    ...obj,
    race_target: DISTANCE_FOCUS_OPTIONS.filter((d) => selected.includes(d)),
  };
}

function migrateAthleteContext(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  const bg =
    obj.background && typeof obj.background === "object"
      ? { ...(obj.background as Record<string, unknown>) }
      : {};
  const other =
    obj.other_context && typeof obj.other_context === "object"
      ? (obj.other_context as Record<string, unknown>)
      : {};
  const notes = typeof bg.notes === "string" ? bg.notes : "";
  const history = typeof bg.history === "string" ? bg.history : "";
  const alreadyMigrated =
    typeof bg.experience === "string" && isExperienceLevel(bg.experience);
  const experience = alreadyMigrated
    ? bg.experience
    : notes
      ? inferExperience(notes)
      : "Intermediate";
  let workLife = typeof bg.work_life === "string" ? bg.work_life : "";
  if (!workLife.trim() && typeof other.note === "string") {
    workLife = other.note;
  }
  let nextHistory = history;
  if (notes && !alreadyMigrated) {
    const leftover = leftoverExperienceNotes(notes);
    if (leftover && !nextHistory.includes(leftover)) {
      nextHistory = nextHistory.trim()
        ? `${nextHistory.trim()}\n\n${leftover}`
        : leftover;
    }
  }
  return {
    ...obj,
    background: {
      history: nextHistory,
      experience,
      work_life: workLife,
    },
    other_context: { note: "", items: [] },
  };
}

function migrateHistoricalPrs(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  const prs = obj.historical_prs;
  if (!prs || typeof prs !== "object") return obj;
  const rec = prs as Record<string, unknown>;
  const events = Array.isArray(rec.events) ? rec.events : [];
  return {
    ...obj,
    historical_prs: {
      note: typeof rec.note === "string" ? rec.note : "",
      events: events.map((row) => {
        if (!row || typeof row !== "object") {
          return { event: "", period: "", time: "", notes: "" };
        }
        const ev = row as Record<string, unknown>;
        const eventRaw = typeof ev.event === "string" ? ev.event : "";
        const distance = typeof ev.distance === "string" ? ev.distance : "";
        const notes = typeof ev.notes === "string" ? ev.notes : "";
        const time = typeof ev.time === "string" ? ev.time : "";
        const periodRaw = typeof ev.period === "string" ? ev.period : "";
        const event = isPrEventName(eventRaw)
          ? eventRaw
          : mapPrEventName(eventRaw, distance);
        const period = isPrPeriod(periodRaw)
          ? periodRaw
          : inferPrPeriod(eventRaw, notes);
        return { event, period, time, notes };
      }),
    },
  };
}

function migratePantry(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  if ("pantry" in obj) return obj;
  return { ...obj, pantry: SEED_PANTRY };
}

function migrateAthleteProfileInput(input: unknown): unknown {
  return migratePantry(
    migrateHistoricalPrs(
      migrateAthleteContext(migrateRaceTarget(migrateGoalRacesInput(input))),
    ),
  );
}

export const athleteProfileSchema = z.preprocess(
  migrateAthleteProfileInput,
  z
    .object({
  name: z.string().min(1, "Name is required"),
  age: z.coerce.number().int().min(1).max(120),
  /** Training / home weather location. WeatherAPI `q=` accepts city + ZIP. */
  location: z.string().default(DEFAULT_LOCATION),
  background: z.object({
    history: z.string(),
    experience: z.enum(EXPERIENCE_LEVELS).default("Intermediate"),
    work_life: z.string().default(""),
  }),
  /** Distances the athlete is building toward this season. */
  race_target: z
    .array(z.enum(DISTANCE_FOCUS_OPTIONS))
    .default([])
    .transform((selected) =>
      DISTANCE_FOCUS_OPTIONS.filter((d) => selected.includes(d)),
    ),
  /**
   * Starred A-race the athlete and coach are building toward.
   * Derived from goal_races on load/save so older readers still work.
   */
  goal_race: goalRaceSchema.default(emptyGoalRace(true)),
  /** Upcoming races; exactly one is primary. */
  goal_races: z.array(goalRaceSchema).default([]),
  /** RunSignup nearby-race search filters. Missing on older profiles. */
  race_search: raceSearchSchema.default(DEFAULT_RACE_SEARCH),
  goals: z.array(z.string()),
  training_philosophy: z.string(),
  historical_prs: z.object({
    note: z.string().default(""),
    events: z.array(prEventSchema),
  }),
  other_context: z
    .object({
      note: z.string().default(""),
      items: z.array(z.string()).default([]),
    })
    .default({ note: "", items: [] }),
  training_zones: z.object({
    note: z.string().default(""),
    easy: zoneSchema,
    lt1: zoneSchema,
    lt2: zoneSchema,
    vo2: zoneSchema,
  }),
  /** Supplements and mixes on hand. The day brief suggests from this list. */
  pantry: z.array(pantryItemSchema).default([]),
  /**
   * Garmin locker is the catalog (injected separately as garminGear).
   * These rows are role/notes overlay keyed by Garmin uuid.
   */
  gear: gearSchema.default({ note: "", shoes: [] }),
  device_context: z.object({
    watch: z.string(),
    note: z.string(),
    /** Last product name written from Garmin; used so a custom Watch is not overwritten. */
    watchFromGarmin: z.string().default(""),
  }),
    })
    .transform((profile) => {
      const synced = syncGoalRaces(profile.goal_races);
      return { ...profile, ...synced };
    }),
);

export type AthleteProfile = z.infer<typeof athleteProfileSchema>;
export type PrEvent = z.infer<typeof prEventSchema>;
export type PantryItem = z.infer<typeof pantryItemSchema>;
export type ProfileShoe = z.infer<typeof shoeSchema>;

function bundledProfilePath(): string {
  return join(process.cwd(), "data", "athlete_profile.json");
}

/** Writable data directory in production (Fly volume). Unset locally. */
export function dataDir(): string | undefined {
  const raw = process.env.DATA_DIR?.trim();
  return raw ? raw.replace(/\/+$/, "") : undefined;
}

function profilePath(): string {
  const dir = dataDir();
  if (!dir) return bundledProfilePath();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "athlete_profile.json");
  if (!existsSync(dest) && existsSync(bundledProfilePath())) {
    copyFileSync(bundledProfilePath(), dest);
  }
  return dest;
}

export function loadAthleteProfile(): AthleteProfile {
  const path = profilePath();
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid JSON in athlete profile (${detail}). Strings like times and dates must be quoted, e.g. "time": "1:52", "date": "2002-06-23".`,
    );
  }
  const result = athleteProfileSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid athlete profile shape: ${detail}`);
  }
  return result.data;
}

export function saveAthleteProfile(input: unknown): AthleteProfile {
  const result = athleteProfileSchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid athlete profile: ${detail}`);
  }
  const profile = result.data;
  writeFileSync(profilePath(), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return profile;
}

/** Profile JSON for prompts: overlay only, no leftover manual catalog names. */
export function profileForPrompt(profile: AthleteProfile): AthleteProfile {
  return {
    ...profile,
    gear: {
      note: profile.gear.note,
      shoes: profile.gear.shoes
        .filter((shoe) => shoe.uuid)
        .map((shoe) => ({
          uuid: shoe.uuid,
          status: shoe.status,
          notes: shoe.notes,
        })),
    },
    device_context: {
      watch: profile.device_context.watch,
      note: profile.device_context.note,
      watchFromGarmin: "",
    },
  };
}

const DEFAULT_OPTICAL_NOTE =
  "Optical wrist HR can cadence-lock; prefer pace and how the run felt over a brief HR spike.";

export function applyGarminWatchToProfile(
  profile: AthleteProfile,
  garminWatchName: string,
): AthleteProfile {
  const name = garminWatchName.trim();
  if (!name) return profile;
  const ctx = profile.device_context;
  return {
    ...profile,
    device_context: {
      watch: name,
      note: ctx.note.trim() ? ctx.note : DEFAULT_OPTICAL_NOTE,
      watchFromGarmin: name,
    },
  };
}

export function emptyPrEvent(): PrEvent {
  return {
    event: "",
    period: "",
    time: "",
    notes: "",
  };
}
