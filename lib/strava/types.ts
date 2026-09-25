/** Strava API activity summary (list endpoint). */
export type StravaApiActivity = {
  id: number;
  athlete?: { id: number };
  name: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  type?: string;
  sport_type?: string;
  workout_type?: number | null;
  start_date?: string;
  start_date_local?: string;
  timezone?: string;
  trainer?: boolean;
  commute?: boolean;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  kilojoules?: number;
  suffer_score?: number;
  calories?: number;
  description?: string | null;
  gear_id?: string | null;
  map?: { summary_polyline?: string | null };
};

export type StravaApiSplit = {
  distance?: number;
  elapsed_time?: number;
  moving_time?: number;
  elevation_difference?: number;
  average_speed?: number;
  average_heartrate?: number;
  split?: number;
  pace_zone?: number;
};

export type StravaApiLap = {
  id?: number;
  name?: string;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  lap_index?: number;
  split?: number;
};

/** Detailed activity from GET /activities/{id} — includes splits & laps. */
export type StravaApiActivityDetail = StravaApiActivity & {
  description?: string | null;
  splits_metric?: StravaApiSplit[];
  splits_standard?: StravaApiSplit[];
  laps?: StravaApiLap[];
  calories?: number;
  /** Present on detailed activities when gear was assigned. */
  gear?: StravaApiGear | null;
};

export type StravaApiGear = {
  id: string;
  primary?: boolean;
  name: string;
  nickname?: string | null;
  resource_state?: number;
  retired?: boolean;
  distance?: number;
  converted_distance?: number;
  brand_name?: string | null;
  model_name?: string | null;
  description?: string | null;
};

export type StravaApiAthlete = {
  id: number;
  shoes?: StravaApiGear[];
  bikes?: StravaApiGear[];
};

/** Strava workout_type: 1 race, 2 long run, 3 workout (running). */
export function isRaceWorkoutType(workoutType: number | null | undefined): boolean {
  return workoutType === 1;
}

export function classifyActivityKind(input: {
  sportType: string;
  workoutType: number | null | undefined;
  name: string;
}): {
  isRace: boolean;
  kindLabel: string;
} {
  const nameLower = input.name.toLowerCase();
  const isRace =
    isRaceWorkoutType(input.workoutType) ||
    /\brace\b/.test(nameLower) ||
    /\bpr\b/.test(nameLower);

  let kindLabel = input.sportType;
  if (input.workoutType === 3) kindLabel = `${input.sportType} (workout)`;
  else if (input.workoutType === 2) kindLabel = `${input.sportType} (long run)`;
  else if (isRace) kindLabel = `${input.sportType} (race)`;
  else if (input.sportType === "VirtualRun") kindLabel = "Treadmill / virtual run";
  else if (input.sportType === "TrailRun") kindLabel = "Trail run";

  return { isRace, kindLabel };
}
