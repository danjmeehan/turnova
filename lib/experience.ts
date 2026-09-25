export const EXPERIENCE_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export function isExperienceLevel(value: string): value is ExperienceLevel {
  return (EXPERIENCE_LEVELS as readonly string[]).includes(value);
}

export function inferExperience(notes: string): ExperienceLevel {
  const n = notes.toLowerCase();
  if (/\bbeginner\b/.test(n) && !/not a beginner/.test(n)) return "Beginner";
  if (/\b(experienced|elite|advanced|masters)\b/.test(n)) return "Advanced";
  return "Intermediate";
}

export function leftoverExperienceNotes(notes: string): string {
  return notes
    .replace(/^(experienced|beginner|intermediate|advanced)\s*;?\s*/i, "")
    .trim();
}
