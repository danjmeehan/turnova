"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type GarminStatus = {
  connected: boolean;
  displayName: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  mfaPending: boolean;
};

type RateSnapshot = {
  read15m: number;
  readDaily: number;
  read15mLimit: number;
  readDailyLimit: number;
  overall15m: number;
  overallDaily: number;
};

export type StravaStatus = {
  connected: boolean;
  athleteId: number | null;
  activityCount: number;
  gearCount: number;
  configuredLimits?: {
    read15mLimit: number;
    readDailyLimit: number;
    headroom: number;
  };
  rate?: {
    snapshot: RateSnapshot | null;
    budget: { ok: boolean; reason?: string; retryAt?: string };
    rateLimitedUntil: string | null;
  };
  sync: {
    backfillComplete: boolean;
    autoBackfillEnabled: boolean;
    lastSyncedAt: string | null;
    activitiesSynced: number;
    lastError: string | null;
    rateLimitedUntil: string | null;
    recentMissingSplits?: number;
  } | null;
};

export type StravaChunkResult = {
  activitiesUpserted: number;
  detailsFetched: number;
  pagesFetched: number;
  requestsUsed: number;
  totalActivities: number;
  backfillComplete: boolean;
  recentMissingSplits: number;
  paused: boolean;
  pauseReason: string | null;
  retryAt: string | null;
  autoBackfillEnabled: boolean;
  rateLimit: RateSnapshot | null;
};

type SyncStatusContextValue = {
  strava: StravaStatus | null;
  garmin: GarminStatus | null;
  refreshStrava: () => Promise<StravaStatus | null>;
  refreshGarmin: () => Promise<GarminStatus | null>;
  refreshAll: () => Promise<void>;
};

const SyncStatusContext = createContext<SyncStatusContextValue | null>(null);

export function formatAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function stravaTone(status: StravaStatus | null): {
  label: string;
  badge: string;
} | null {
  if (!status?.connected) return null;
  const missingSplits = status.sync?.recentMissingSplits ?? 0;
  if (status.sync?.lastError) return { label: "error", badge: "badge-error" };
  if (!status.sync?.backfillComplete || missingSplits > 0) {
    return { label: "incomplete", badge: "badge-warning" };
  }
  return { label: "ready", badge: "badge-success" };
}

export function isStravaFullyReady(r: {
  backfillComplete: boolean;
  recentMissingSplits: number;
}): boolean {
  return r.backfillComplete && r.recentMissingSplits === 0;
}

export async function syncStravaChunk(opts?: {
  auto?: boolean;
  refreshGear?: boolean;
}): Promise<StravaChunkResult> {
  const res = await fetch("/api/strava/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chunk: true,
      auto: opts?.auto,
      refreshGear: opts?.refreshGear,
    }),
  });
  const data = (await res.json()) as {
    error?: string;
    result?: StravaChunkResult;
  };
  if (!res.ok) {
    throw new Error(data.error || "Sync failed");
  }
  return data.result!;
}

export async function syncGarmin(): Promise<{
  upserted: number;
  skipped: number;
}> {
  const res = await fetch("/api/garmin/sync", { method: "POST" });
  const data = (await res.json()) as {
    error?: string;
    upserted?: number;
    skipped?: number;
  };
  if (!res.ok) throw new Error(data.error || "Sync failed");
  return { upserted: data.upserted ?? 0, skipped: data.skipped ?? 0 };
}

export function notifyStravaSynced() {
  window.dispatchEvent(new Event("turnova:strava-synced"));
}

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [strava, setStrava] = useState<StravaStatus | null>(null);
  const [garmin, setGarmin] = useState<GarminStatus | null>(null);

  const refreshStrava = useCallback(async () => {
    try {
      const res = await fetch("/api/strava/sync");
      if (!res.ok) return null;
      const data = (await res.json()) as StravaStatus;
      setStrava(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const refreshGarmin = useCallback(async () => {
    try {
      const res = await fetch("/api/garmin/status");
      if (!res.ok) return null;
      const data = (await res.json()) as GarminStatus;
      setGarmin(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStrava(), refreshGarmin()]);
  }, [refreshStrava, refreshGarmin]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const value = useMemo(
    () => ({ strava, garmin, refreshStrava, refreshGarmin, refreshAll }),
    [strava, garmin, refreshStrava, refreshGarmin, refreshAll],
  );

  return (
    <SyncStatusContext.Provider value={value}>
      {children}
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus(): SyncStatusContextValue {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) {
    throw new Error("useSyncStatus must be used within SyncStatusProvider");
  }
  return ctx;
}
