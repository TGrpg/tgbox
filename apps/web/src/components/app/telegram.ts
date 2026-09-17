/**
 * Telegram Mini App bridge. Telegram opens the app with the launch params in the URL fragment
 * (`#tgWebAppData=…`); outside Telegram none of this runs and telegram-web-app.js is never loaded.
 *
 * A copy of `apps/admin/src/lib/telegram.ts` on purpose: the two apps ship separately and should
 * not share a module across worker boundaries.
 */

type ThemeParams = Partial<
  Record<
    | "bg_color"
    | "text_color"
    | "hint_color"
    | "link_color"
    | "button_color"
    | "button_text_color"
    | "secondary_bg_color"
    | "section_bg_color"
    | "accent_text_color",
    string
  >
>;

export type MainButtonParams = {
  text?: string;
  is_active?: boolean;
  is_visible?: boolean;
};

export type TelegramWebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: ThemeParams;
  ready: () => void;
  expand: () => void;
  close: () => void;
  onEvent: (event: "themeChanged" | "viewportChanged", handler: () => void) => void;
  offEvent: (event: "themeChanged" | "viewportChanged", handler: () => void) => void;
  openLink: (url: string) => void;
  openTelegramLink: (url: string) => void;
  openInvoice: (
    url: string,
    callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void,
  ) => void;
  switchInlineQuery: (query: string, chatTypes?: string[]) => void;
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
  MainButton: {
    setText: (text: string) => void;
    setParams: (params: MainButtonParams) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const STORAGE_KEY = "tgbox-app:init-data";

/**
 * Signed initData for the auth header. Kept in sessionStorage because the four screens are
 * separate documents and only the first one is opened with the launch fragment.
 */
export function telegramInitData(): string | null {
  if (typeof window === "undefined") return null;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData");
  if (fromHash) sessionStorage.setItem(STORAGE_KEY, fromHash);
  return fromHash ?? sessionStorage.getItem(STORAGE_KEY);
}

export const isTelegram = () => telegramInitData() !== null;

/** `language_code` of the launching user, read from the raw launch string (not from the SDK). */
export function launchLanguage(): string | null {
  const raw = telegramInitData();
  if (!raw) return null;
  const user: unknown = JSON.parse(new URLSearchParams(raw).get("user") ?? "null");
  return typeof user === "object" && user !== null && "language_code" in user
    ? String(user.language_code)
    : null;
}

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
  ["bg_color", ["--card", "--popover"]],
  ["section_bg_color", ["--card", "--popover"]],
  ["secondary_bg_color", ["--background", "--muted", "--secondary", "--accent"]],
  ["text_color", ["--foreground", "--card-foreground", "--popover-foreground"]],
  ["hint_color", ["--muted-foreground"]],
  ["link_color", ["--primary-accent", "--accent-foreground"]],
  ["accent_text_color", ["--primary-accent"]],
  ["button_color", ["--primary", "--outline"]],
  ["button_text_color", ["--primary-foreground"]],
];

/** Maps Telegram's theme colors onto the site's design tokens, so the app follows the client. */
export function applyTelegramTheme(webApp: TelegramWebApp) {
  const root = document.documentElement;
  root.classList.toggle("dark", webApp.colorScheme === "dark");
  for (const [param, vars] of themeVars) {
    const color = webApp.themeParams[param];
    if (!color) continue;
    for (const name of vars) root.style.setProperty(name, color);
  }
}

/** `switchInlineQuery` only works when the app was opened from a chat; fall back to a share link. */
export function shareEntry(webApp: TelegramWebApp | null, query: string, shareUrl: string) {
  try {
    if (webApp) {
      webApp.switchInlineQuery(query, ["users", "groups", "channels"]);
      return;
    }
  } catch {
    // Opened from the bot's menu button rather than a chat — share the link instead.
  }
  if (webApp) webApp.openTelegramLink(shareUrl);
  else window.open(shareUrl, "_blank", "noopener");
}
