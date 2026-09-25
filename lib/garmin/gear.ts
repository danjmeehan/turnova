/**
 * Garmin Connect gear locker: catalog upsert, stats, prompt payload, overlay match.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { GarminApi, GarminGearItem } from "@/lib/garmin/client";
import {
  loadAthleteProfile,
  normalizeGearRole,
  saveAthleteProfile,
  type AthleteProfile,
  type ProfileShoe,
} from "@/lib/athlete-profile";
import { todayDateKey } from "@/lib/week";

const STATS_CONCURRENCY = 3;

export type GarminGearRecord = {
  uuid: string;
  displayName: string;
  customMakeModel: string | null;
  gearTypeName: string | null;
  retired: boolean;
  garminMiles: number;
  status: string;
  notes: string;
};

function metersToMiles(m: number | null | undefined): number {
  if (m == null || !Number.isFinite(m) || m < 0) return 0;
  return Math.round((m / 1609.344) * 10) / 10;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function upsertCatalogItem(item: GarminGearItem): Promise<void> {
  await prisma.garminGear.upsert({
    where: { uuid: item.uuid },
    create: {
      uuid: item.uuid,
      displayName: item.displayName,
      customMakeModel: item.customMakeModel,
      gearTypeName: item.gearTypeName,
      dateBegin: item.dateBegin,
      dateEnd: item.dateEnd,
      retired: item.retired,
      distanceMeters: 0,
      raw: item.raw as Prisma.InputJsonValue,
    },
    update: {
      displayName: item.displayName,
      customMakeModel: item.customMakeModel,
      gearTypeName: item.gearTypeName,
      dateBegin: item.dateBegin,
      dateEnd: item.dateEnd,
      retired: item.retired,
      raw: item.raw as Prisma.InputJsonValue,
    },
  });
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function catalogHaystack(item: {
  displayName: string;
  customMakeModel: string | null;
}): string {
  return normalizeName(
    [item.displayName, item.customMakeModel].filter(Boolean).join(" "),
  );
}

function distinctiveTokens(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .filter((part) => part.length >= 5);
}

function matchLegacyShoe(
  shoe: ProfileShoe,
  catalog: Array<{ uuid: string; displayName: string; customMakeModel: string | null }>,
): string | null {
  const needles = [shoe.name, shoe.nickname]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeName)
    .filter(Boolean);
  if (needles.length === 0) return null;

  const exact = catalog.filter((item) => {
    const hay = catalogHaystack(item);
    return needles.some((needle) => hay === needle);
  });
  if (exact.length === 1) return exact[0].uuid;

  const tokens = needles.flatMap(distinctiveTokens);
  if (tokens.length === 0) return null;
  const fuzzy = catalog.filter((item) => {
    const hay = catalogHaystack(item);
    return tokens.some((token) => hay.includes(token));
  });
  if (fuzzy.length === 1) return fuzzy[0].uuid;
  return null;
}

function matchOverlayToCatalog(
  profile: AthleteProfile,
  catalog: Array<{ uuid: string; displayName: string; customMakeModel: string | null }>,
): AthleteProfile {
  const used = new Set(
    profile.gear.shoes.map((shoe) => shoe.uuid).filter(Boolean),
  );
  let changed = false;
  const shoes = profile.gear.shoes.map((shoe) => {
    if (shoe.uuid) return shoe;
    const uuid = matchLegacyShoe(shoe, catalog);
    if (!uuid || used.has(uuid)) return shoe;
    used.add(uuid);
    changed = true;
    return {
      uuid,
      status: normalizeGearRole(shoe.status),
      notes: shoe.notes,
    };
  });
  if (!changed) return profile;
  return {
    ...profile,
    gear: {
      ...profile.gear,
      shoes: shoes.filter((shoe) => shoe.uuid),
    },
  };
}

export async function syncGarminGear(
  api: GarminApi,
  userProfilePk: number,
): Promise<number> {
  const catalog = await api.getGear(userProfilePk);
  if (catalog == null) {
    console.error("[garmin/gear] filterGear returned no payload");
    return 0;
  }
  const available = await api.getGear(userProfilePk, todayDateKey());
  const availableIds =
    available == null ? null : new Set(available.map((item) => item.uuid));
  const items = catalog.map((item) => ({
    ...item,
    retired:
      item.retired ||
      Boolean(availableIds && !availableIds.has(item.uuid)),
  }));
  const seen = new Set(items.map((item) => item.uuid));
  for (const item of items) {
    await upsertCatalogItem(item);
  }
  if (seen.size > 0) {
    await prisma.garminGear.updateMany({
      where: { uuid: { notIn: [...seen] }, retired: false },
      data: { retired: true },
    });
  } else {
    await prisma.garminGear.updateMany({
      where: { retired: false },
      data: { retired: true },
    });
  }

  const active = items.filter((item) => !item.retired);
  await mapPool(active, STATS_CONCURRENCY, async (item) => {
    try {
      const meters = await api.getGearStatsDistance(item.uuid);
      if (meters == null) return;
      await prisma.garminGear.update({
        where: { uuid: item.uuid },
        data: { distanceMeters: meters },
      });
    } catch (err) {
      console.error(
        "[garmin/gear] stats failed",
        item.uuid,
        err instanceof Error ? err.message : err,
      );
    }
  });

  try {
    const profile = loadAthleteProfile();
    const matched = matchOverlayToCatalog(profile, active);
    if (matched !== profile) saveAthleteProfile(matched);
  } catch (err) {
    console.error(
      "[garmin/gear] overlay match failed",
      err instanceof Error ? err.message : err,
    );
  }

  return active.length;
}

export async function listGarminGear(): Promise<GarminGearRecord[]> {
  const rows = await prisma.garminGear.findMany({
    where: { retired: false },
    orderBy: { displayName: "asc" },
  });
  let overlay: ProfileShoe[] = [];
  try {
    overlay = loadAthleteProfile().gear.shoes;
  } catch {
    overlay = [];
  }
  const byUuid = new Map(overlay.filter((s) => s.uuid).map((s) => [s.uuid, s]));
  return rows.map((row) => {
    const note = byUuid.get(row.uuid);
    return {
      uuid: row.uuid,
      displayName: row.displayName,
      customMakeModel: row.customMakeModel,
      gearTypeName: row.gearTypeName,
      retired: row.retired,
      garminMiles: metersToMiles(row.distanceMeters),
      status: normalizeGearRole(note?.status),
      notes: note?.notes ?? "",
    };
  });
}
