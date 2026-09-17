import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "tgbox-admin:theme";

// Runs before paint so the stored/system theme applies without a flash.
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})();`;

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);
  return {
    theme,
    toggle: () => {
      const next = theme === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem(KEY, next);
      setTheme(next);
    },
  };
}
