"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/login?next=${encodeURIComponent(next)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      if (!res.ok) {
        setError("Invalid password");
        return;
      }
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <fieldset className="fieldset">
        <legend className="fieldset-legend">Password</legend>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="bit-field input input-bordered w-full bg-base-100"
          autoFocus
        />
      </fieldset>
      {error && (
        <div role="alert" className="alert alert-error py-2 text-sm">
          <span>{error}</span>
        </div>
      )}
      <button
        type="submit"
        className="bit-btn btn btn-primary w-full"
        disabled={busy || !password}
      >
        {busy ? (
          <span className="loading loading-spinner loading-sm" />
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
