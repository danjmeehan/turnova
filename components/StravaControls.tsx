"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatAgo,
  isStravaFullyReady,
  notifyStravaSynced,
  syncStravaChunk,
  useSyncStatus,
} from "@/components/sync-status";

function formatWait(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m`;
}

function toastClass(message: string): string {
  const lower = message.toLowerCase();
  if (/fail|error|invalid/.test(lower)) return "alert-error";
  if (
    /connected\.|complete —|complete -|synced —|synced -|^synced |disconnected/.test(
      lower,
    )
  ) {
    return "alert-success";
  }
  return "alert-info";
}

export function StravaControls() {
  const { strava: status, refreshStrava } = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNext = useCallback(
    (retryAt: string | null) => {
      clearTimer();
      if (!autoRef.current) return;
      const target = retryAt ? new Date(retryAt).getTime() : Date.now() + 2000;
      const delay = Math.max(2000, target - Date.now() + 1500);
      setMessage(
        `Rate limit pause — next chunk in ${formatWait(new Date(Date.now() + delay).toISOString())}`,
      );
      timerRef.current = setTimeout(() => {
        void (async () => {
          if (!autoRef.current) return;
          try {
            setBusy(true);
            const result = await syncStravaChunk({ auto: true });
            await refreshStrava();
            notifyStravaSynced();
            if (isStravaFullyReady(result)) {
              autoRef.current = false;
              setAutoRunning(false);
              setMessage(
                `Complete — ${result.totalActivities} activities with splits on recent sessions.`,
              );
              return;
            }
            if (result.paused) {
              scheduleNext(result.retryAt);
            } else {
              setMessage(
                `Auto: +${result.activitiesUpserted} activities, +${result.detailsFetched} split details (${result.recentMissingSplits} recent still need splits). Continuing…`,
              );
              scheduleNext(null);
            }
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Auto-backfill failed");
            autoRef.current = false;
            setAutoRunning(false);
            await fetch("/api/strava/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ auto: false }),
            });
          } finally {
            setBusy(false);
          }
        })();
      }, delay);
    },
    [refreshStrava],
  );

  useEffect(() => {
    setAutoRunning(Boolean(status?.sync?.autoBackfillEnabled));
  }, [status?.sync?.autoBackfillEnabled]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("strava");
    if (flag === "connected") {
      setMessage("Strava connected. Start Auto-backfill for history + splits.");
      window.history.replaceState({}, "", "/");
      void refreshStrava();
    } else if (flag === "error") {
      setMessage(params.get("message") || "Strava connection failed");
      window.history.replaceState({}, "", "/");
    }
    return () => clearTimer();
  }, [refreshStrava]);

  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(id);
  }, [message]);

  async function onStartAuto() {
    setBusy(true);
    setMessage(null);
    try {
      autoRef.current = true;
      setAutoRunning(true);
      await fetch("/api/strava/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto: true }),
      });
      const result = await syncStravaChunk({ auto: true, refreshGear: true });
      await refreshStrava();
      notifyStravaSynced();
      if (isStravaFullyReady(result)) {
        autoRef.current = false;
        setAutoRunning(false);
        setMessage(
          `Complete — ${result.totalActivities} activities with recent splits.`,
        );
        return;
      }
      if (result.paused) {
        scheduleNext(result.retryAt);
      } else {
        setMessage(
          `Auto running: ${result.recentMissingSplits} recent still need splits.`,
        );
        scheduleNext(null);
      }
    } catch (e) {
      autoRef.current = false;
      setAutoRunning(false);
      setMessage(e instanceof Error ? e.message : "Auto-backfill failed");
    } finally {
      setBusy(false);
    }
  }

  async function onStopAuto() {
    clearTimer();
    autoRef.current = false;
    setAutoRunning(false);
    await fetch("/api/strava/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto: false }),
    });
    setMessage("Auto-backfill stopped.");
    await refreshStrava();
  }

  const missingSplits = status?.sync?.recentMissingSplits ?? 0;
  const needsAuto =
    status?.connected &&
    (!status.sync?.backfillComplete || missingSplits > 0);

  const toast = message
    ? createPortal(
        <div className="toast toast-end z-[80]">
          <div role="status" className={`alert ${toastClass(message)} py-2 text-sm`}>
            <span>{message}</span>
          </div>
        </div>,
        document.body,
      )
    : null;

  const statusLine = status?.connected
    ? `${status.activityCount} activities · synced ${formatAgo(status.sync?.lastSyncedAt ?? null)}${
        !status.sync?.backfillComplete
          ? " · history incomplete"
          : missingSplits > 0
            ? ` · ${missingSplits} need splits`
            : ""
      }${autoRunning ? " · auto…" : ""}`
    : "Not connected";

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-base-content/55">Strava</p>
      <p className="text-xs leading-snug text-base-content/70">{statusLine}</p>
      {!status?.connected ? (
        <a href="/api/strava/connect" className="btn btn-primary btn-sm">
          Connect Strava
        </a>
      ) : needsAuto ? (
        autoRunning ? (
          <button
            type="button"
            onClick={() => void onStopAuto()}
            className="btn btn-ghost btn-sm"
          >
            Stop auto
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onStartAuto()}
            disabled={busy}
            className="btn btn-primary btn-sm"
          >
            Auto-backfill
          </button>
        )
      ) : null}

      {toast}
    </div>
  );
}
