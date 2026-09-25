"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  formatAgo,
  syncGarmin,
  useSyncStatus,
} from "@/components/sync-status";

function toastClass(message: string): string {
  const lower = message.toLowerCase();
  if (/blocked|unknown|captcha|rate-limit/.test(lower)) return "alert-warning";
  if (/fail|error|invalid/.test(lower)) return "alert-error";
  if (/connected\.|complete —|complete -|synced |disconnected/.test(lower)) {
    return "alert-success";
  }
  return "alert-info";
}

function looksLikeGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function humanGarminLabel(name: string | null): string | null {
  if (!name || looksLikeGuid(name)) return null;
  return name;
}

export function GarminControls() {
  const { garmin: status, refreshGarmin } = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [modalHint, setModalHint] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  function closeModal() {
    setModalOpen(false);
    setPassword("");
    setMfaCode("");
    setMfaRequired(false);
    setModalHint(null);
  }

  async function onConnect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setModalHint(null);
    setToast(null);
    try {
      if (mfaRequired) {
        const res = await fetch("/api/garmin/mfa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: mfaCode }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || "MFA failed");
        closeModal();
        setToast("Garmin connected.");
        await refreshGarmin();
        return;
      }

      const res = await fetch("/api/garmin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as {
        error?: string;
        mfaRequired?: boolean;
        connected?: boolean;
      };
      if (!res.ok) throw new Error(data.error || "Connect failed");
      if (data.mfaRequired) {
        setMfaRequired(true);
        setPassword("");
        setModalHint("Enter the Garmin MFA code.");
        return;
      }
      closeModal();
      setToast("Garmin connected.");
      await refreshGarmin();
    } catch (err) {
      setModalHint(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSync() {
    setBusy(true);
    setToast(null);
    try {
      const data = await syncGarmin();
      setToast(
        `Synced ${data.upserted} recovery days` +
          (data.skipped ? ` (${data.skipped} skipped)` : "") +
          ".",
      );
      await refreshGarmin();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    setBusy(true);
    setToast(null);
    try {
      await fetch("/api/garmin/status", { method: "DELETE" });
      setToast("Garmin disconnected.");
      await refreshGarmin();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  const toastNode = toast
    ? createPortal(
        <div className="toast toast-end z-[80]">
          <div role="status" className={`alert ${toastClass(toast)} py-2 text-sm`}>
            <span>{toast}</span>
          </div>
        </div>,
        document.body,
      )
    : null;

  const label = humanGarminLabel(status?.displayName ?? null);
  const statusLine = status?.connected
    ? `${label ? `${label} · ` : ""}synced ${formatAgo(status.lastSyncedAt)}${
        status.lastError ? " · last sync had an error" : ""
      }`
    : "Not connected";

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-base-content/55">Garmin</p>
      <p className="text-xs leading-snug text-base-content/70">{statusLine}</p>
      {!status?.connected ? (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            setModalHint(null);
            setModalOpen(true);
          }}
        >
          Connect Garmin
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => void onSync()}
            disabled={busy}
            className="btn btn-outline btn-sm"
          >
            {busy ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              "Sync Garmin"
            )}
          </button>
          <button
            type="button"
            onClick={() => void onDisconnect()}
            disabled={busy}
            className="btn btn-ghost btn-sm"
          >
            Disconnect
          </button>
        </div>
      )}

      {toastNode}

      {modalOpen
        ? createPortal(
            <div className="modal modal-open modal-bottom sm:modal-middle">
              <button
                type="button"
                className="modal-backdrop bg-neutral/40"
                aria-label="Close"
                onClick={closeModal}
              />
              <div className="modal-box">
                <h3 className="font-display text-lg font-semibold">
                  Connect Garmin
                </h3>
                <p className="mt-1 text-sm text-base-content/70">
                  Email and password go to Garmin only. Turnova stores session
                  tokens, never your password. If Connect returns UNKNOWN,
                  Garmin is blocking Fly&apos;s IP — wait, then run{" "}
                  <code className="text-xs">
                    npm run garmin:login -- --push
                  </code>{" "}
                  on this Mac.
                </p>
                <form
                  className="mt-4 space-y-3"
                  onSubmit={(e) => void onConnect(e)}
                >
                  <fieldset className="fieldset">
                    <legend className="fieldset-legend">Garmin email</legend>
                    <input
                      type="email"
                      autoComplete="username"
                      className="input input-bordered w-full"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={mfaRequired || busy}
                    />
                  </fieldset>
                  {!mfaRequired ? (
                    <fieldset className="fieldset">
                      <legend className="fieldset-legend">Password</legend>
                      <input
                        type="password"
                        autoComplete="current-password"
                        className="input input-bordered w-full"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={busy}
                      />
                    </fieldset>
                  ) : (
                    <fieldset className="fieldset">
                      <legend className="fieldset-legend">MFA code</legend>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        className="input input-bordered w-full"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                        required
                        disabled={busy}
                      />
                    </fieldset>
                  )}
                  {modalHint ? (
                    <div
                      role="alert"
                      className={`alert ${toastClass(modalHint)} py-2 text-sm`}
                    >
                      <span>{modalHint}</span>
                    </div>
                  ) : null}
                  <div className="modal-action">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={closeModal}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={busy}
                    >
                      {busy ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : mfaRequired ? (
                        "Verify"
                      ) : (
                        "Connect"
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
