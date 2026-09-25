"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { AthleteProfile, PrEvent } from "@/lib/athlete-profile";
import {
  DISTANCE_FOCUS_OPTIONS,
  type DistanceFocus,
} from "@/lib/distance-focus";
import { EXPERIENCE_LEVELS, isExperienceLevel } from "@/lib/experience";
import {
  isPrEventName,
  isPrPeriod,
  PR_EVENT_NAMES,
  PR_PERIODS,
} from "@/lib/pr-catalog";
import { GEAR_ROLES, normalizeGearRole } from "@/lib/gear-role";
import {
  computeGoalRaceStatus,
  emptyGoalRace,
  GOAL_RACE_STATUS_LABELS,
  type GoalRace,
} from "@/lib/goal-race";
import { RaceSearch } from "@/components/RaceSearch";
import type { RaceSearchHit } from "@/lib/race-search";

type Props = {
  open: boolean;
  onClose: () => void;
};

type GarminGearRow = {
  uuid: string;
  displayName: string;
  customMakeModel: string | null;
  gearTypeName: string | null;
  retired: boolean;
  garminMiles: number;
  status: string;
  notes: string;
};

const ZONE_KEYS = ["easy", "lt1", "lt2", "vo2"] as const;

const FIELD =
  "input h-9 min-h-9 w-full rounded-none border-0 border-b border-base-300 bg-transparent px-0 text-sm shadow-none focus:border-primary focus:outline-none focus:ring-0";
const FIELD_LOCKED = `${FIELD} text-base-content/70`;
const FIELD_GROW = `${FIELD} min-w-0 flex-1`;
const SELECT =
  "select h-9 min-h-9 w-full rounded-none border-0 border-b border-base-300 bg-transparent px-0 text-sm shadow-none focus:border-primary focus:outline-none focus:ring-0";
const TEXTAREA =
  "textarea min-h-[4.5rem] w-full rounded-none border-0 border-b border-base-300 bg-transparent px-0 text-sm leading-relaxed shadow-none focus:border-primary focus:outline-none focus:ring-0";
const TEXTAREA_TALL = `${TEXTAREA} min-h-[9rem]`;
const HINT = "mt-1.5 text-[11px] leading-snug text-base-content/40";
const PROSE = "text-xs leading-relaxed text-base-content/50";
const EMPTY = "text-xs leading-relaxed text-base-content/40";
const TEXT_ACTION =
  "btn btn-ghost btn-sm h-auto min-h-0 px-1 py-0.5 font-normal text-base-content/55 hover:bg-transparent hover:text-primary";
const ARTICLE = "space-y-3 py-5 first:pt-1";

function emptyPr(): PrEvent {
  return { event: "", period: "", time: "", notes: "" };
}

function DistanceFocusField({
  value,
  onChange,
}: {
  value: DistanceFocus[];
  onChange: (next: DistanceFocus[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const summary = value.length > 0 ? value.join(", ") : "Select distances";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id="profile-race"
        className={`${FIELD} text-left`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value.length > 0 ? "" : "text-base-content/40"}>
          {summary}
        </span>
      </button>
      {open ? (
        <ul
          className="bit-box absolute z-30 mt-1 w-full bg-base-100 p-2"
          role="listbox"
          aria-multiselectable
        >
          {DISTANCE_FOCUS_OPTIONS.map((option) => {
            const checked = value.includes(option);
            return (
              <li key={option} role="option" aria-selected={checked}>
                <label className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm rounded-none"
                    checked={checked}
                    onChange={() =>
                      onChange(
                        DISTANCE_FOCUS_OPTIONS.filter((d) =>
                          d === option ? !checked : value.includes(d),
                        ),
                      )
                    }
                  />
                  {option}
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-base-content/40"
    >
      {children}
    </label>
  );
}

function ProfileSection({
  title,
  defaultOpen = false,
  action,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <section className="border-b border-base-300/70">
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-3 py-4 text-left"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <h3 className="font-display text-[15px] font-semibold tracking-tight">
          {title}
        </h3>
        <span className="text-[11px] font-normal tracking-wide text-base-content/35">
          {open ? "Close" : "Open"}
        </span>
      </button>
      {open ? (
        <div id={panelId} className="pb-5">
          {action ? (
            <div className="mb-4 flex flex-wrap justify-end gap-4">{action}</div>
          ) : null}
          <div className="space-y-5">{children}</div>
        </div>
      ) : null}
    </section>
  );
}

export function ProfileEditor({ open, onClose }: Props) {
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [garminGear, setGarminGear] = useState<GarminGearRow[]>([]);
  const [garminConnected, setGarminConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [raceSearchOpen, setRaceSearchOpen] = useState(false);
  const [scrollNewPr, setScrollNewPr] = useState(false);
  const newPrRef = useRef<HTMLLIElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileRes, gearRes] = await Promise.all([
        fetch("/api/profile"),
        fetch("/api/garmin/gear"),
      ]);
      const data = (await profileRes.json()) as {
        profile?: AthleteProfile;
        error?: string;
      };
      if (!profileRes.ok) {
        throw new Error(data.error || `Failed to load profile (${profileRes.status})`);
      }
      if (!data.profile) throw new Error("No profile returned");
      setProfile(data.profile);
      if (gearRes.ok) {
        const gearData = (await gearRes.json()) as {
          connected?: boolean;
          gear?: GarminGearRow[];
        };
        setGarminConnected(Boolean(gearData.connected));
        setGarminGear(Array.isArray(gearData.gear) ? gearData.gear : []);
      } else {
        setGarminConnected(false);
        setGarminGear([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    else setRaceSearchOpen(false);
  }, [open, load]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!scrollNewPr) return;
    newPrRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setScrollNewPr(false);
  }, [scrollNewPr, profile?.historical_prs.events.length]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || saving) return;
    setSaving(true);
    setError(null);
    try {
      const cleaned: AthleteProfile = {
        ...profile,
        goals: profile.goals.map((g) => g.trim()).filter(Boolean),
        other_context: {
          ...profile.other_context,
          items: profile.other_context.items
            .map((i) => i.trim())
            .filter(Boolean),
        },
        historical_prs: {
          ...profile.historical_prs,
          events: profile.historical_prs.events.filter(
            (ev) =>
              ev.event.trim() ||
              ev.period.trim() ||
              ev.time.trim() ||
              ev.notes.trim(),
          ),
        },
        goal_races: profile.goal_races.filter(
          (race) =>
            race.name.trim() ||
            race.date.trim() ||
            race.distance.trim() ||
            race.goal_time.trim() ||
            race.notes.trim(),
        ),
        gear: {
          ...profile.gear,
          shoes:
            garminGear.length > 0
              ? garminGear.map((item) => ({
                  uuid: item.uuid,
                  status: item.status,
                  notes: item.notes,
                }))
              : profile.gear.shoes.filter(
                  (s) => s.uuid.trim() || Boolean(s.name?.trim()),
                ),
        },
      };
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: cleaned }),
      });
      const data = (await res.json()) as {
        profile?: AthleteProfile;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      if (!data.profile) throw new Error("No profile returned");
      setProfile(data.profile);
      setToast("Profile saved.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof AthleteProfile>(
    key: K,
    value: AthleteProfile[K],
  ) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  function updatePr(index: number, patch: Partial<PrEvent>) {
    setProfile((p) => {
      if (!p) return p;
      const events = p.historical_prs.events.map((ev, i) =>
        i === index ? { ...ev, ...patch } : ev,
      );
      return {
        ...p,
        historical_prs: { ...p.historical_prs, events },
      };
    });
  }

  function updateGoalRace(index: number, patch: Partial<GoalRace>) {
    setProfile((p) => {
      if (!p) return p;
      const goal_races = p.goal_races.map((race, i) =>
        i === index ? { ...race, ...patch } : race,
      );
      return { ...p, goal_races };
    });
  }

  function setPrimaryRace(index: number) {
    setProfile((p) => {
      if (!p) return p;
      const goal_races = p.goal_races.map((race, i) => ({
        ...race,
        primary: i === index,
      }));
      return { ...p, goal_races, goal_race: goal_races[index]! };
    });
  }

  function addGoalRace() {
    setProfile((p) => {
      if (!p) return p;
      const next = emptyGoalRace(p.goal_races.length === 0);
      return { ...p, goal_races: [...p.goal_races, next] };
    });
    setRaceSearchOpen(false);
  }

  function addRaceFromSearch(hit: RaceSearchHit) {
    setProfile((p) => {
      if (!p) return p;
      const next: GoalRace = {
        ...emptyGoalRace(p.goal_races.length === 0),
        name: hit.name,
        date: hit.date,
        distance: hit.distance,
        location: hit.city,
        source: "runsignup",
        runsignup_race_id: hit.raceId,
        runsignup_event_id: hit.eventId,
        url: hit.url,
      };
      return { ...p, goal_races: [...p.goal_races, next] };
    });
    setRaceSearchOpen(false);
  }

  function removeGoalRace(index: number) {
    setProfile((p) => {
      if (!p) return p;
      const remaining = p.goal_races.filter((_, i) => i !== index);
      if (remaining.length > 0 && !remaining.some((race) => race.primary)) {
        remaining[0] = { ...remaining[0]!, primary: true };
      }
      return { ...p, goal_races: remaining };
    });
  }

  function removePr(index: number) {
    setProfile((p) => {
      if (!p) return p;
      return {
        ...p,
        historical_prs: {
          ...p.historical_prs,
          events: p.historical_prs.events.filter((_, i) => i !== index),
        },
      };
    });
  }

  if (!open && !toast) return null;

  return (
    <>
      {toast
        ? createPortal(
            <div className="toast toast-end z-[80]">
              <div role="status" className="alert alert-success py-2 text-sm">
                <span>{toast}</span>
              </div>
            </div>,
            document.body,
          )
        : null}
      {open ? (
    <div className="modal modal-open modal-end">
      <button
        type="button"
        className="modal-backdrop bg-neutral/40"
        aria-label="Close athlete profile editor"
        onClick={onClose}
      />
      <div
        className="modal-box m-0 flex h-dvh max-h-dvh w-full max-w-lg flex-col rounded-none border-l-[3px] border-neutral bg-base-100 p-0 shadow-none"
        role="dialog"
        aria-labelledby="profile-editor-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-base-300/70 px-6 py-5">
          <div>
            <h2
              id="profile-editor-title"
              className="font-display text-xl font-semibold tracking-tight"
            >
              Athlete profile
            </h2>
            <p className="mt-1 text-xs text-base-content/45">
              Used in every coaching chat
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={TEXT_ACTION}
          >
            Close
          </button>
        </header>

        <form
          onSubmit={(e) => void onSave(e)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-1 text-sm">
            {loading && (
              <div className="flex items-center gap-2 text-base-content/60">
                <span className="loading loading-spinner loading-sm text-primary" />
                Loading…
              </div>
            )}

            {profile && !loading && (
              <>
                <ProfileSection title="Identity" defaultOpen>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <div className="col-span-2 sm:col-span-1">
                      <FieldLabel htmlFor="profile-name">Name</FieldLabel>
                      <input
                        id="profile-name"
                        className={FIELD}
                        value={profile.name}
                        onChange={(e) => update("name", e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor="profile-age">Age</FieldLabel>
                      <input
                        id="profile-age"
                        type="number"
                        min={1}
                        max={120}
                        className={FIELD}
                        value={profile.age}
                        onChange={(e) =>
                          update("age", Number(e.target.value) || 0)
                        }
                        required
                      />
                    </div>
                    <div className="col-span-2">
                      <FieldLabel htmlFor="profile-location">
                        Location
                      </FieldLabel>
                      <input
                        id="profile-location"
                        className={FIELD}
                        value={profile.location}
                        onChange={(e) => update("location", e.target.value)}
                        placeholder="Hopewell Junction, NY 12533"
                      />
                      <p className={HINT}>
                        Used for local weather in coaching. City, ZIP, or both.
                      </p>
                    </div>
                    <div className="col-span-2">
                      <FieldLabel htmlFor="profile-philosophy">
                        Training philosophy
                      </FieldLabel>
                      <input
                        id="profile-philosophy"
                        className={FIELD}
                        value={profile.training_philosophy}
                        onChange={(e) =>
                          update("training_philosophy", e.target.value)
                        }
                      />
                    </div>
                  </div>
                </ProfileSection>

                <ProfileSection title="Goals">
                  <div>
                    <FieldLabel htmlFor="profile-race">Distance focus</FieldLabel>
                    <DistanceFocusField
                      value={profile.race_target}
                      onChange={(race_target) =>
                        update("race_target", race_target)
                      }
                    />
                    <p className={HINT}>
                      Distances you are building toward this season. Pick as
                      many as fit.
                    </p>
                  </div>
                  <div>
                    <div className="mb-3 flex items-baseline justify-end">
                      <button
                        type="button"
                        className={TEXT_ACTION}
                        onClick={() =>
                          update("goals", [...profile.goals, ""])
                        }
                      >
                        Add goal
                      </button>
                    </div>
                    {profile.goals.length === 0 && (
                      <p className={EMPTY}>No goals yet.</p>
                    )}
                    <ul className="space-y-3">
                      {profile.goals.map((goal, index) => (
                        <li key={index} className="flex items-baseline gap-3">
                          <input
                            className={FIELD_GROW}
                            value={goal}
                            onChange={(e) => {
                              const goals = [...profile.goals];
                              goals[index] = e.target.value;
                              update("goals", goals);
                            }}
                            placeholder="Goal"
                          />
                          <button
                            type="button"
                            className={TEXT_ACTION}
                            aria-label={`Remove goal ${index + 1}`}
                            onClick={() =>
                              update(
                                "goals",
                                profile.goals.filter((_, i) => i !== index),
                              )
                            }
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </ProfileSection>

                <ProfileSection
                  title="Goal races"
                  action={
                    <div className="flex flex-wrap justify-end gap-4">
                      <button
                        type="button"
                        className={TEXT_ACTION}
                        onClick={() =>
                          setRaceSearchOpen((openSearch) => !openSearch)
                        }
                      >
                        Search
                      </button>
                      <button
                        type="button"
                        className={TEXT_ACTION}
                        onClick={addGoalRace}
                      >
                        Add unlisted
                      </button>
                    </div>
                  }
                >
                  <p className={PROSE}>
                    Search RunSignup or add an unlisted race, then Save. Star
                    the race you and the coach are building toward. Status is
                    set from the race date. Notes stay in every chat.
                  </p>
                  {raceSearchOpen ? (
                    <RaceSearch
                      settings={profile.race_search}
                      onSettingsChange={(race_search) =>
                        update("race_search", race_search)
                      }
                      onSelect={addRaceFromSearch}
                      onManual={addGoalRace}
                      onCancel={() => setRaceSearchOpen(false)}
                    />
                  ) : null}
                  {profile.goal_races.length === 0 && (
                    <p className={EMPTY}>
                      No races yet — add the next event you are training for.
                    </p>
                  )}
                  <ul>
                    {profile.goal_races.map((race, index) => {
                      const status = computeGoalRaceStatus(race.date);
                      const locked = race.source === "runsignup";
                      return (
                        <li
                          key={race.id || index}
                          className={ARTICLE}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <button
                              type="button"
                              className={`${TEXT_ACTION} gap-1.5 ${
                                race.primary
                                  ? "text-primary hover:text-primary"
                                  : ""
                              }`}
                              aria-pressed={race.primary}
                              aria-label={
                                race.primary
                                  ? "Primary race"
                                  : "Set as primary race"
                              }
                              onClick={() => setPrimaryRace(index)}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 20 20"
                                className="size-3.5"
                                fill={race.primary ? "currentColor" : "none"}
                                stroke="currentColor"
                                strokeWidth="1.5"
                                aria-hidden
                              >
                                <path d="M10 1.6 12.2 6l4.9.7-3.5 3.5.8 4.9L10 13.3 5.6 16.1l.8-4.9L2.9 6.7 7.8 6 10 1.6z" />
                              </svg>
                              Primary
                            </button>
                            <div className="flex items-baseline gap-3">
                              <span className="text-[11px] uppercase tracking-[0.08em] text-base-content/45">
                                {GOAL_RACE_STATUS_LABELS[status] ?? status}
                              </span>
                              <button
                                type="button"
                                className={TEXT_ACTION}
                                onClick={() => removeGoalRace(index)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                            <div className="col-span-2">
                              <FieldLabel htmlFor={`goal-race-name-${index}`}>
                                Race name
                              </FieldLabel>
                              <input
                                id={`goal-race-name-${index}`}
                                className={locked ? FIELD_LOCKED : FIELD}
                                value={race.name}
                                readOnly={locked}
                                onChange={(e) =>
                                  updateGoalRace(index, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="e.g. Syracuse Half"
                              />
                              {locked && race.url ? (
                                <a
                                  href={race.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1.5 inline-block text-[11px] text-base-content/45 hover:text-primary"
                                >
                                  RunSignup listing
                                </a>
                              ) : null}
                            </div>
                            <div>
                              <FieldLabel htmlFor={`goal-race-date-${index}`}>
                                Date
                              </FieldLabel>
                              <input
                                id={`goal-race-date-${index}`}
                                className={locked ? FIELD_LOCKED : FIELD}
                                value={race.date}
                                readOnly={locked}
                                onChange={(e) =>
                                  updateGoalRace(index, {
                                    date: e.target.value,
                                  })
                                }
                                placeholder="YYYY-MM-DD"
                              />
                            </div>
                            <div>
                              <FieldLabel
                                htmlFor={`goal-race-distance-${index}`}
                              >
                                Distance
                              </FieldLabel>
                              <input
                                id={`goal-race-distance-${index}`}
                                className={locked ? FIELD_LOCKED : FIELD}
                                value={race.distance}
                                readOnly={locked}
                                onChange={(e) =>
                                  updateGoalRace(index, {
                                    distance: e.target.value,
                                  })
                                }
                                placeholder="Half Marathon"
                              />
                            </div>
                            <div className="col-span-2">
                              <FieldLabel
                                htmlFor={`goal-race-location-${index}`}
                              >
                                Location
                              </FieldLabel>
                              <input
                                id={`goal-race-location-${index}`}
                                className={FIELD}
                                value={race.location ?? ""}
                                onChange={(e) =>
                                  updateGoalRace(index, {
                                    location: e.target.value,
                                  })
                                }
                                placeholder="Hopewell Junction, NY"
                              />
                            </div>
                            <div>
                              <FieldLabel htmlFor={`goal-race-time-${index}`}>
                                Goal time
                              </FieldLabel>
                              <input
                                id={`goal-race-time-${index}`}
                                className={FIELD}
                                value={race.goal_time}
                                onChange={(e) =>
                                  updateGoalRace(index, {
                                    goal_time: e.target.value,
                                  })
                                }
                                placeholder="1:30:00"
                              />
                            </div>
                            <div>
                              <FieldLabel
                                htmlFor={`goal-race-priority-${index}`}
                              >
                                Priority
                              </FieldLabel>
                              <select
                                id={`goal-race-priority-${index}`}
                                className={SELECT}
                                value={race.priority}
                                onChange={(e) =>
                                  updateGoalRace(index, {
                                    priority: e.target.value,
                                  })
                                }
                              >
                                <option value="A">A (peak)</option>
                                <option value="B">B (supporting)</option>
                                <option value="C">C (tune-up)</option>
                              </select>
                            </div>
                            <div className="col-span-2">
                              <FieldLabel htmlFor={`goal-race-notes-${index}`}>
                                Collaboration notes
                              </FieldLabel>
                              <textarea
                                id={`goal-race-notes-${index}`}
                                rows={3}
                                className={TEXTAREA}
                                value={race.notes}
                                onChange={(e) =>
                                  updateGoalRace(index, {
                                    notes: e.target.value,
                                  })
                                }
                                placeholder="Target rationale, course, constraints, open questions, decisions from coaching chats…"
                              />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </ProfileSection>

                <ProfileSection title="Athlete Context">
                  <div>
                    <FieldLabel htmlFor="profile-history">Background</FieldLabel>
                    <textarea
                      id="profile-history"
                      rows={6}
                      className={TEXTAREA_TALL}
                      value={profile.background.history}
                      onChange={(e) =>
                        update("background", {
                          ...profile.background,
                          history: e.target.value,
                        })
                      }
                    />
                    <p className={HINT}>
                      Running and athletic background the coach should know.
                    </p>
                  </div>
                  <div>
                    <FieldLabel htmlFor="profile-experience">
                      Experience
                    </FieldLabel>
                    <select
                      id="profile-experience"
                      className={SELECT}
                      value={profile.background.experience}
                      onChange={(e) => {
                        const experience = e.target.value;
                        if (!isExperienceLevel(experience)) return;
                        update("background", {
                          ...profile.background,
                          experience,
                        });
                      }}
                    >
                      {EXPERIENCE_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="profile-work-life">Work/Life</FieldLabel>
                    <textarea
                      id="profile-work-life"
                      rows={6}
                      className={TEXTAREA_TALL}
                      value={profile.background.work_life}
                      onChange={(e) =>
                        update("background", {
                          ...profile.background,
                          work_life: e.target.value,
                        })
                      }
                    />
                    <p className={HINT}>
                      Job load, family weeks, health, and other constraints.
                    </p>
                  </div>
                </ProfileSection>

                <ProfileSection
                  title="Historical PRs"
                  action={
                    <button
                      type="button"
                      className={TEXT_ACTION}
                      onClick={(e) => {
                        e.stopPropagation();
                        update("historical_prs", {
                          ...profile.historical_prs,
                          events: [emptyPr(), ...profile.historical_prs.events],
                        });
                        setScrollNewPr(true);
                      }}
                    >
                      Add PR
                    </button>
                  }
                >
                  <p className={PROSE}>
                    PRs that pre-date your Strava data
                  </p>
                  {profile.historical_prs.events.length === 0 && (
                    <p className={EMPTY}>
                      No PRs yet — add collegiate or lifetime marks.
                    </p>
                  )}
                  <ul>
                    {profile.historical_prs.events.map((ev, index) => (
                      <li
                        key={index}
                        className={ARTICLE}
                        ref={index === 0 ? newPrRef : undefined}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="font-display text-sm font-medium">
                            {ev.event.trim() || `PR ${index + 1}`}
                          </p>
                          <button
                            type="button"
                            className={TEXT_ACTION}
                            onClick={() => removePr(index)}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                          <div>
                            <FieldLabel htmlFor={`pr-event-${index}`}>
                              Event
                            </FieldLabel>
                            <select
                              id={`pr-event-${index}`}
                              className={SELECT}
                              value={ev.event}
                              onChange={(e) => {
                                const event = e.target.value;
                                if (event !== "" && !isPrEventName(event)) {
                                  return;
                                }
                                updatePr(index, { event });
                              }}
                            >
                              <option value="">Select event</option>
                              {PR_EVENT_NAMES.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <FieldLabel htmlFor={`pr-period-${index}`}>
                              Time period
                            </FieldLabel>
                            <select
                              id={`pr-period-${index}`}
                              className={SELECT}
                              value={ev.period}
                              onChange={(e) => {
                                const period = e.target.value;
                                if (period !== "" && !isPrPeriod(period)) {
                                  return;
                                }
                                updatePr(index, { period });
                              }}
                            >
                              <option value="">Select period</option>
                              {PR_PERIODS.map((period) => (
                                <option key={period} value={period}>
                                  {period}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <FieldLabel htmlFor={`pr-time-${index}`}>
                              Time
                            </FieldLabel>
                            <input
                              id={`pr-time-${index}`}
                              className={FIELD}
                              value={ev.time}
                              onChange={(e) =>
                                updatePr(index, { time: e.target.value })
                              }
                              placeholder="1:52"
                            />
                          </div>
                          <div className="col-span-2">
                            <FieldLabel htmlFor={`pr-notes-${index}`}>
                              Notes
                            </FieldLabel>
                            <input
                              id={`pr-notes-${index}`}
                              className={FIELD}
                              value={ev.notes}
                              onChange={(e) =>
                                updatePr(index, { notes: e.target.value })
                              }
                            />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </ProfileSection>

                <ProfileSection title="Training zones">
                  <div>
                    <FieldLabel htmlFor="zones-note">Section note</FieldLabel>
                    <input
                      id="zones-note"
                      className={FIELD}
                      value={profile.training_zones.note}
                      onChange={(e) =>
                        update("training_zones", {
                          ...profile.training_zones,
                          note: e.target.value,
                        })
                      }
                    />
                  </div>
                  {ZONE_KEYS.map((key) => (
                    <div key={key}>
                      <FieldLabel htmlFor={`zone-${key}`}>
                        {key.toUpperCase()}
                      </FieldLabel>
                      <textarea
                        id={`zone-${key}`}
                        rows={2}
                        className={TEXTAREA}
                        value={profile.training_zones[key].description}
                        onChange={(e) =>
                          update("training_zones", {
                            ...profile.training_zones,
                            [key]: { description: e.target.value },
                          })
                        }
                      />
                    </div>
                  ))}
                </ProfileSection>

                <ProfileSection title="Shoes / gear">
                  <p className={PROSE}>
                    Locker from Garmin Connect (active gear only). Tag shoes on
                    Strava activities when you want the coach to know which pair
                    was on a given run. Sync Garmin to refresh names and mileage.
                  </p>
                  <div>
                    <FieldLabel htmlFor="gear-note">Section note</FieldLabel>
                    <input
                      id="gear-note"
                      className={FIELD}
                      value={profile.gear.note}
                      onChange={(e) =>
                        update("gear", {
                          ...profile.gear,
                          note: e.target.value,
                        })
                      }
                    />
                  </div>
                  {!garminConnected && (
                    <p className={EMPTY}>
                      Connect Garmin, then Sync Once to load gear.
                    </p>
                  )}
                  {garminConnected && garminGear.length === 0 && (
                    <p className={EMPTY}>
                      No Garmin gear yet. Sync Once after shoes are in Garmin
                      Connect.
                    </p>
                  )}
                  <ul>
                    {garminGear.map((item) => (
                      <li key={item.uuid} className={ARTICLE}>
                        <div>
                          <p className="font-display text-sm font-medium">
                            {item.displayName}
                          </p>
                          <p className="mt-0.5 text-[11px] tracking-wide text-base-content/45">
                            {[
                              item.gearTypeName,
                              item.customMakeModel &&
                              item.customMakeModel !== item.displayName
                                ? item.customMakeModel
                                : null,
                              `${item.garminMiles} mi`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                          <div>
                            <FieldLabel htmlFor={`shoe-status-${item.uuid}`}>
                              Role
                            </FieldLabel>
                            <select
                              id={`shoe-status-${item.uuid}`}
                              className={SELECT}
                              value={normalizeGearRole(item.status)}
                              onChange={(e) => {
                                const status = e.target.value;
                                setGarminGear((rows) =>
                                  rows.map((row) =>
                                    row.uuid === item.uuid
                                      ? { ...row, status }
                                      : row,
                                  ),
                                );
                              }}
                            >
                              <option value="">Select role</option>
                              {GEAR_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <FieldLabel htmlFor={`shoe-notes-${item.uuid}`}>
                              Notes
                            </FieldLabel>
                            <input
                              id={`shoe-notes-${item.uuid}`}
                              className={FIELD}
                              value={item.notes}
                              onChange={(e) => {
                                const notes = e.target.value;
                                setGarminGear((rows) =>
                                  rows.map((row) =>
                                    row.uuid === item.uuid
                                      ? { ...row, notes }
                                      : row,
                                  ),
                                );
                              }}
                            />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </ProfileSection>

                <ProfileSection title="Device">
                  <p className={PROSE}>
                    Watch name from Garmin Connect. The note is yours — sync
                    will not replace one you already wrote.
                  </p>
                  {!garminConnected && (
                    <p className={EMPTY}>
                      Connect Garmin, then Sync Once to load your watch.
                    </p>
                  )}
                  {garminConnected &&
                    !profile.device_context.watchFromGarmin && (
                      <p className={EMPTY}>
                        No watch from Garmin yet. Sync Once after your watch is
                        in Garmin Connect.
                      </p>
                    )}
                  <div>
                    <FieldLabel htmlFor="device-watch">Watch</FieldLabel>
                    <input
                      id="device-watch"
                      className={FIELD_LOCKED}
                      value={profile.device_context.watch}
                      readOnly
                    />
                    {profile.device_context.watchFromGarmin ? (
                      <p className={HINT}>from Garmin</p>
                    ) : null}
                  </div>
                  <div>
                    <FieldLabel htmlFor="device-note">Note</FieldLabel>
                    <textarea
                      id="device-note"
                      rows={2}
                      className={TEXTAREA}
                      value={profile.device_context.note}
                      onChange={(e) =>
                        update("device_context", {
                          ...profile.device_context,
                          note: e.target.value,
                        })
                      }
                    />
                  </div>
                </ProfileSection>
              </>
            )}
          </div>

          <footer className="flex shrink-0 flex-col gap-3 border-t border-base-300/70 px-6 py-5">
            {error ? (
              <div role="alert" className="alert alert-error py-2 text-sm">
                <span>{error}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-4">
            <button
              type="button"
              className={TEXT_ACTION}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm px-5"
              disabled={!profile || loading || saving}
            >
              {saving ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                "Save profile"
              )}
            </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
      ) : null}
    </>
  );
}
