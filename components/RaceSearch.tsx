"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_RACE_SEARCH,
  RACE_SEARCH_TYPE_OPTIONS,
  type RaceSearchHit,
  type RaceSearchSettings,
  type SearchEventType,
} from "@/lib/race-search";

type Props = {
  settings?: RaceSearchSettings;
  onSettingsChange?: (next: RaceSearchSettings) => void;
  onSelect: (hit: RaceSearchHit) => void;
  onManual: () => void;
  onCancel: () => void;
};

export function RaceSearch({
  settings,
  onSettingsChange,
  onSelect,
  onManual,
  onCancel,
}: Props) {
  const filters = settings ?? DEFAULT_RACE_SEARCH;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RaceSearchHit[]>([]);
  const [zip, setZip] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const typesKey = filters.event_types.join(",");

  useEffect(() => {
    const ac = new AbortController();
    const handle = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("radius", String(filters.radius_miles));
      params.set("months", String(filters.window_months));
      params.set("types", typesKey);
      void fetch(`/api/races/search?${params.toString()}`, { signal: ac.signal })
        .then(async (res) => {
          const data = (await res.json()) as {
            races?: RaceSearchHit[];
            zip?: string;
            error?: string;
          };
          if (!res.ok) {
            throw new Error(data.error || `Search failed (${res.status})`);
          }
          setHits(data.races ?? []);
          setZip(data.zip ?? null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setHits([]);
          setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, query.trim() ? 300 : 0);
    return () => {
      window.clearTimeout(handle);
      ac.abort();
    };
  }, [query, filters.radius_miles, filters.window_months, typesKey]);

  function patch(partial: Partial<RaceSearchSettings>) {
    onSettingsChange?.({ ...filters, ...partial });
  }

  function toggleType(id: SearchEventType) {
    const selected = new Set(filters.event_types);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    const event_types = RACE_SEARCH_TYPE_OPTIONS.map((option) => option.id).filter(
      (type) => selected.has(type),
    );
    patch({ event_types });
  }

  const monthsLabel = filters.window_months === 1 ? "month" : "months";
  const milesLabel = filters.radius_miles === 1 ? "mile" : "miles";

  return (
    <div className="space-y-4 border-b border-base-300/70 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-base-content/50">
          Official races in the next {filters.window_months} {monthsLabel}{" "}
          within {filters.radius_miles} {milesLabel}
          {zip ? ` of ${zip}` : ""}.
        </p>
        <button type="button" className="btn btn-ghost btn-sm h-auto min-h-0 px-1 py-0.5 font-normal text-base-content/55 hover:bg-transparent hover:text-primary shrink-0" onClick={onCancel}>
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-5">
        <label className="w-20">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-base-content/40">
            Miles
          </span>
          <input
            type="number"
            min={1}
            max={250}
            className="input h-9 min-h-9 w-full rounded-none border-0 border-b border-base-300 bg-transparent px-0 text-sm shadow-none focus:border-primary focus:outline-none focus:ring-0"
            value={filters.radius_miles}
            onChange={(e) =>
              patch({
                radius_miles: Math.min(250, Math.max(1, Number(e.target.value) || 1)),
              })
            }
          />
        </label>
        <label className="w-20">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-base-content/40">
            Months
          </span>
          <input
            type="number"
            min={1}
            max={24}
            className="input h-9 min-h-9 w-full rounded-none border-0 border-b border-base-300 bg-transparent px-0 text-sm shadow-none focus:border-primary focus:outline-none focus:ring-0"
            value={filters.window_months}
            onChange={(e) =>
              patch({
                window_months: Math.min(24, Math.max(1, Number(e.target.value) || 1)),
              })
            }
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {RACE_SEARCH_TYPE_OPTIONS.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-base-content/60"
          >
            <input
              type="checkbox"
              className="checkbox checkbox-xs checkbox-primary"
              checked={filters.event_types.includes(option.id)}
              onChange={() => toggleType(option.id)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <input
        type="search"
        className="input h-9 min-h-9 w-full rounded-none border-0 border-b border-base-300 bg-transparent px-0 text-sm shadow-none focus:border-primary focus:outline-none focus:ring-0"
        placeholder="Search races near you"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-base-content/50">
          <span className="loading loading-spinner loading-xs text-primary" />
          Searching…
        </div>
      ) : error ? (
        <div role="alert" className="alert alert-error py-2 text-xs">
          <span>{error}</span>
        </div>
      ) : hits.length === 0 ? (
        <p className="text-xs leading-relaxed text-base-content/40">No matching races.</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {hits.map((hit) => (
            <li key={`${hit.raceId}-${hit.eventId}`}>
              <button
                type="button"
                className="btn btn-ghost btn-sm h-auto min-h-0 w-full flex-col items-start gap-0.5 rounded-none px-0 py-2.5 font-normal hover:bg-transparent"
                onClick={() => onSelect(hit)}
              >
                <span className="w-full truncate text-left font-display text-sm font-medium">
                  {hit.name}
                </span>
                <span className="w-full truncate text-left text-[11px] text-base-content/45">
                  {hit.distance}
                  {hit.eventName && hit.eventName !== hit.distance
                    ? ` · ${hit.eventName}`
                    : ""}
                  {" · "}
                  {hit.date}
                  {hit.city ? ` · ${hit.city}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-ghost btn-sm h-auto min-h-0 px-1 py-0.5 font-normal text-base-content/55 hover:bg-transparent hover:text-primary" onClick={onManual}>
        Not listed
      </button>
    </div>
  );
}
