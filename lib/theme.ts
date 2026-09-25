export const THEME_KEY = "turnova-theme";
const LEGACY_THEME_KEY = "coachy-theme";
export const DARK_THEME = "coffee";
export const LIGHT_THEME = "retro";

export type AppTheme = typeof DARK_THEME | typeof LIGHT_THEME;

export const THEME_COLORS: Record<AppTheme, string> = {
  coffee: "#322a33",
  retro: "#ece3ca",
};

const LEGACY_THEME_MAP: Record<string, AppTheme> = {
  forest: DARK_THEME,
  emerald: LIGHT_THEME,
};

export function isAppTheme(value: string | null): value is AppTheme {
  return value === DARK_THEME || value === LIGHT_THEME;
}

function migrateTheme(value: string | null): AppTheme | null {
  if (isAppTheme(value)) return value;
  if (value && value in LEGACY_THEME_MAP) return LEGACY_THEME_MAP[value];
  return null;
}

export function readStoredTheme(): AppTheme | null {
  try {
    const stored = migrateTheme(localStorage.getItem(THEME_KEY));
    if (stored) {
      localStorage.setItem(THEME_KEY, stored);
      return stored;
    }
    const legacy = migrateTheme(localStorage.getItem(LEGACY_THEME_KEY));
    if (legacy) {
      localStorage.setItem(THEME_KEY, legacy);
      return legacy;
    }
  } catch {
    // Ignore quota / private-mode failures.
  }
  return null;
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore quota / private-mode failures.
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_KEY)};var t=localStorage.getItem(k);if(!t){t=localStorage.getItem(${JSON.stringify(LEGACY_THEME_KEY)});if(t)try{localStorage.setItem(k,t)}catch(e){}}if(t==="forest")t=${JSON.stringify(DARK_THEME)};if(t==="emerald")t=${JSON.stringify(LIGHT_THEME)};if(t!==${JSON.stringify(DARK_THEME)}&&t!==${JSON.stringify(LIGHT_THEME)})return;try{localStorage.setItem(k,t)}catch(e){}document.documentElement.setAttribute("data-theme",t);var c=t===${JSON.stringify(LIGHT_THEME)}?${JSON.stringify(THEME_COLORS.retro)}:${JSON.stringify(THEME_COLORS.coffee)};var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c);}catch(e){}})();`;
