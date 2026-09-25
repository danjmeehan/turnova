"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatAgo,
  notifyStravaSynced,
  stravaTone,
  syncGarmin,
  syncStravaChunk,
  useSyncStatus,
  isStravaFullyReady,
} from "@/components/sync-status";

function toastClass(message: string): string {
  const lower = message.toLowerCase();
  if (/fail|error|invalid/.test(lower)) return "alert-error";
  if (/synced |recovery/.test(lower)) return "alert-success";
  return "alert-info";
}

function stravaResultMessage(result: {
  totalActivities: number;
  activitiesUpserted: number;
  recentMissingSplits: number;
  backfillComplete: boolean;
  paused: boolean;
  pauseReason: string | null;
}): string {
  if (isStravaFullyReady(result)) {
    return `Strava: ${result.totalActivities} activities`;
  }
  if (result.paused) {
    return `Strava paused (${result.pauseReason})`;
  }
  return `Strava: +${result.activitiesUpserted} activities`;
}

export function HeaderSync() {
  const { strava, garmin, refreshAll } = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const stravaChipTone = stravaTone(strava);
  const canSync = Boolean(strava?.connected || garmin?.connected);

  async function onSyncBoth() {
    setBusy(true);
    setToast(null);
    const parts: string[] = [];
    try {
      if (strava?.connected) {
        try {
          const result = await syncStravaChunk({ refreshGear: true });
          notifyStravaSynced();
          parts.push(stravaResultMessage(result));
        } catch (err) {
          parts.push(
            `Strava: ${err instanceof Error ? err.message : "Sync failed"}`,
          );
        }
      }
      if (garmin?.connected) {
        try {
          const data = await syncGarmin();
          parts.push(
            `Garmin: ${data.upserted} recovery days` +
              (data.skipped ? ` (${data.skipped} skipped)` : ""),
          );
        } catch (err) {
          parts.push(
            `Garmin: ${err instanceof Error ? err.message : "Sync failed"}`,
          );
        }
      }
      await refreshAll();
      if (parts.length) setToast(parts.join(" · "));
    } finally {
      setBusy(false);
    }
  }

  const toastNode = toast
    ? createPortal(
        <div className="toast toast-end z-[80]">
          <div
            role="status"
            className={`alert ${toastClass(toast)} py-2 text-sm`}
          >
            <span>{toast}</span>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {stravaChipTone ? (
        <span
          className={`bit-badge badge badge-sm whitespace-nowrap ${stravaChipTone.badge}`}
          title={`Strava last synced ${formatAgo(strava?.sync?.lastSyncedAt ?? null)}`}
        >
          Strava {formatAgo(strava?.sync?.lastSyncedAt ?? null)}
        </span>
      ) : null}
      {garmin?.connected ? (
        <span
          className={`bit-badge badge badge-sm whitespace-nowrap ${
            garmin.lastError ? "badge-error" : "badge-success"
          }`}
          title={`Garmin last synced ${formatAgo(garmin.lastSyncedAt)}`}
        >
          Garmin {formatAgo(garmin.lastSyncedAt)}
        </span>
      ) : null}
      <button
        type="button"
        className="bit-btn btn btn-sm"
        disabled={busy || !canSync}
        onClick={() => void onSyncBoth()}
      >
        {busy ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          "Sync"
        )}
      </button>
      {toastNode}
    </>
  );
}
