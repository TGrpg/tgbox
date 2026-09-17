// Telegram Mini App bridge. Telegram opens the app with launch params in the URL hash
// (`#tgWebAppData=…`); outside Telegram none of this runs and telegram-web-app.js is never loaded.

type ThemeParams = Partial<
  Record<
    | "bg_color"
    | "text_color"
    | "hint_color"
    | "link_color"
    | "button_color"
    | "button_text_color"
    | "secondary_bg_color",
    string
  >
>;

export type TelegramWebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: ThemeParams;
  ready: () => void;
  expand: () => void;
  onEvent: (event: "themeChanged", handler: () => void) => void;
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const STORAGE_KEY = "tgbox-admin:init-data";

/** Signed initData for the auth header; kept in sessionStorage because navigation drops the hash. */
export function telegramInitData() {
  if (typeof window === "undefined") return null;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData");
  if (fromHash) sessionStorage.setItem(STORAGE_KEY, fromHash);
  return fromHash ?? sessionStorage.getItem(STORAGE_KEY);
}

export const isTelegram = () => telegramInitData() !== null;

let loading: Promise<TelegramWebApp | null> | null = null;

export function loadTelegramWebApp() {
  loading ??= new Promise((resolve) => {
    if (window.Telegram?.WebApp) return resolve(window.Telegram.WebApp);
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.onload = () => resolve(window.Telegram?.WebApp ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loading;
}

const themeVars: [keyof ThemeParams, string[]][] = [
  ["bg_color", ["--card", "--popover", "--sidebar-background"]],
  ["secondary_bg_color", ["--background"]],
  ["text_color", ["--foreground", "--card-foreground", "--popover-foreground"]],
  ["hint_color", ["--muted-foreground"]],
  ["link_color", ["--primary-accent"]],
  ["button_color", ["--primary"]],
  ["button_text_color", ["--primary-foreground"]],
];

/** Maps Telegram theme colors onto the app's design tokens. */
export function applyTelegramTheme(webApp: TelegramWebApp) {
  const root = document.documentElement;
  root.classList.toggle("dark", webApp.colorScheme === "dark");
  for (const [param, vars] of themeVars) {
    const color = webApp.themeParams[param];
    if (!color) continue;
    for (const name of vars) root.style.setProperty(name, color);
  }
}
