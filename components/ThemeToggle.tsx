"use client";

import { useEffect, useState } from "react";
import {
  applyTheme,
  DARK_THEME,
  LIGHT_THEME,
  isAppTheme,
  readStoredTheme,
  type AppTheme,
} from "@/lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<AppTheme>(DARK_THEME);

  useEffect(() => {
    let next: AppTheme = DARK_THEME;
    try {
      const stored = readStoredTheme();
      if (stored) next = stored;
      else {
        const attr = document.documentElement.getAttribute("data-theme");
        if (isAppTheme(attr)) next = attr;
      }
    } catch {
      const attr = document.documentElement.getAttribute("data-theme");
      if (isAppTheme(attr)) next = attr;
    }
    setTheme(next);
    applyTheme(next);
  }, []);

  return (
    <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3 px-3">
      <span className="text-sm">Light mode</span>
      <input
        type="checkbox"
        className="toggle toggle-sm"
        checked={theme === LIGHT_THEME}
        onChange={(event) => {
          const next = event.target.checked ? LIGHT_THEME : DARK_THEME;
          setTheme(next);
          applyTheme(next);
        }}
      />
    </label>
  );
}
