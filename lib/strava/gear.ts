/**
 * Shared Strava gear upsert helpers.
 */

import { prisma } from "@/lib/db";
import type { StravaApiGear } from "@/lib/strava/types";

export async function upsertGearRecord(
  gear: StravaApiGear,
  gearType: string,
): Promise<void> {
  await prisma.stravaGear.upsert({
    where: { id: gear.id },
    create: {
      id: gear.id,
      name: gear.name,
      nickname: gear.nickname ?? null,
      gearType,
      brandName: gear.brand_name ?? null,
      modelName: gear.model_name ?? null,
      description: gear.description ?? null,
      primary: Boolean(gear.primary),
      retired: Boolean(gear.retired),
      distanceMeters: gear.distance ?? 0,
      raw: gear as object,
    },
    update: {
      name: gear.name,
      nickname: gear.nickname ?? null,
      gearType,
      brandName: gear.brand_name ?? null,
      modelName: gear.model_name ?? null,
      description: gear.description ?? null,
      primary: Boolean(gear.primary),
      retired: Boolean(gear.retired),
      distanceMeters: gear.distance ?? 0,
      raw: gear as object,
    },
  });
}

/** Ensure a gear row exists so activity.gearId FK can be set. */
export async function ensureGearPlaceholder(
  gearId: string,
  hint?: Partial<StravaApiGear> & { gearType?: string },
): Promise<void> {
  const exists = await prisma.stravaGear.findUnique({ where: { id: gearId } });
  if (exists) {
    if (hint?.name && exists.name === gearId) {
      await prisma.stravaGear.update({
        where: { id: gearId },
        data: {
          name: hint.name,
          nickname: hint.nickname ?? exists.nickname,
          brandName: hint.brand_name ?? exists.brandName,
          modelName: hint.model_name ?? exists.modelName,
          gearType:
            exists.gearType === "unknown" && hint.gearType
              ? hint.gearType
              : exists.gearType,
          raw: hint as object,
        },
      });
    }
    return;
  }
  await prisma.stravaGear.create({
    data: {
      id: gearId,
      name: hint?.name ?? gearId,
      nickname: hint?.nickname ?? null,
      gearType: hint?.gearType ?? "unknown",
      brandName: hint?.brand_name ?? null,
      modelName: hint?.model_name ?? null,
      description: hint?.description ?? null,
      primary: Boolean(hint?.primary),
      retired: Boolean(hint?.retired),
      distanceMeters: hint?.distance ?? 0,
      raw: hint ? (hint as object) : undefined,
    },
  });
}

export function inferGearType(gearId: string): string {
  if (gearId.startsWith("g")) return "shoe";
  if (gearId.startsWith("b")) return "bike";
  return "unknown";
}
