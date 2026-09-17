import type { Locale } from "@tgbox/shared";
import {
  CompassIcon,
  MegaphoneIcon,
  PlusIcon,
  SendIcon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/coss/ui/button";
import { Spinner } from "@/components/coss/ui/spinner";
import { localizePath } from "@/i18n/locale.ts";
import { appUi } from "@/i18n/ui-app.ts";
import { cn } from "@/lib/cn.ts";
import type { ApiError } from "./api.ts";
import { preferredLocale } from "./locale.ts";
import {
  applyTelegramTheme,
  isTelegram,
  loadTelegramWebApp,
  type TelegramWebApp,
} from "./telegram.ts";

export type AppScreen = "browse" | "submit" | "me" | "promote";

/**
 * Whether we are running inside Telegram. `pending` is what both the prerendered HTML and the
 * first client render show, so hydration never has to reconcile two different trees.
 */
export type TelegramState =
  | { status: "pending" }
  | { status: "inside"; webApp: TelegramWebApp | null }
  | { status: "outside" };

export function useTelegramBridge(): TelegramState {
  const [state, setState] = useState<TelegramState>({ status: "pending" });

  useEffect(() => {
    if (!isTelegram()) {
      setState({ status: "outside" });
      return;
    }
    setState({ status: "inside", webApp: null });
    void loadTelegramWebApp().then((webApp) => {
      if (webApp) {
        webApp.ready();
        webApp.expand();
        applyTelegramTheme(webApp);
        webApp.onEvent("themeChanged", () => applyTelegramTheme(webApp));
      }
      setState({ status: "inside", webApp });
    });
  }, []);

  return state;
}

const WebAppContext = createContext<TelegramWebApp | null>(null);

/** The live `Telegram.WebApp`, or null outside Telegram (and until the SDK has loaded). */
export const useWebApp = () => useContext(WebAppContext);

const BackContext = createContext<(handler: (() => void) | null) => void>(() => {});

/**
 * Overrides Telegram's BackButton for a screen that has its own steps (the promotion flow).
 * Pass a memoized handler, or `null` to hand the button back to the shell.
 */
export function useBackHandler(handler: (() => void) | null) {
  const register = useContext(BackContext);
  useEffect(() => {
    register(handler);
    return () => register(null);
  }, [handler, register]);
}

/**
 * The primary action of a screen. Inside Telegram it is the native MainButton; without it (the
 * SDK failed to load, or the page was opened in a browser) the same action stays reachable as an
 * ordinary button.
 */
export function PrimaryAction({
  text,
  onClick,
  disabled = false,
  loading = false,
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const webApp = useWebApp();
  const latest = useRef(onClick);
  useEffect(() => {
    latest.current = onClick;
  }, [onClick]);

  useEffect(() => {
    if (!webApp) return;
    const button = webApp.MainButton;
    const click = () => latest.current();
    button.onClick(click);
    return () => {
      button.offClick(click);
      button.hide();
    };
  }, [webApp]);

  useEffect(() => {
    if (!webApp) return;
    const button = webApp.MainButton;
    button.setParams({ text, is_visible: true, is_active: !disabled && !loading });
    if (loading) button.showProgress(true);
    else button.hideProgress();
  }, [webApp, text, disabled, loading]);

  if (webApp) return null;
  return (
    <Button size="lg" className="w-full" disabled={disabled} loading={loading} onClick={onClick}>
      {text}
    </Button>
  );
}

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center" aria-live="polite">
      <span className="flex flex-col items-center gap-3 text-muted-foreground text-sm">
        <Spinner className="size-6" />
        {label}
      </span>
    </div>
  );
}

export function ErrorScreen({
  locale,
  error,
  onRetry,
}: {
  locale: Locale;
  error: ApiError;
  onRetry?: () => void;
}) {
  const strings = appUi(locale).common;
  const message =
    error === "unauthorized"
      ? strings.unauthorized
      : error === "banned"
        ? strings.banned
        : strings.error;
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="flex max-w-xs flex-col items-center gap-3">
        <TriangleAlertIcon className="size-9 text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground text-sm">{message}</p>
        {onRetry && error !== "banned" && (
          <Button variant="outline" onClick={onRetry}>
            {strings.retry}
          </Button>
        )}
      </div>
    </div>
  );
}

/** No launch payload: the page was opened outside Telegram, so nothing signed can happen here. */
export function OutsideTelegram({ locale, botUrl }: { locale: Locale; botUrl: string }) {
  const strings = appUi(locale);
  return (
    <div className="grid min-h-[70vh] place-items-center px-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
          <SendIcon className="size-6" aria-hidden />
        </span>
        <h1 className="font-semibold text-lg">{strings.outside.title}</h1>
        <p className="text-muted-foreground text-sm">{strings.outside.lead}</p>
        <div className="flex flex-col gap-2 self-stretch">
          <Button render={<a href={botUrl} rel="noopener" target="_blank" />}>
            {strings.outside.openBot}
          </Button>
          <Button variant="ghost" render={<a href={localizePath("/", locale)} />}>
            {strings.outside.browse}
          </Button>
        </div>
      </div>
    </div>
  );
}

export const screenPaths: Record<AppScreen, string> = {
  browse: "/app/",
  submit: "/app/submit/",
  me: "/app/me/",
  promote: "/app/promote/",
};

const screenIcons = {
  browse: CompassIcon,
  submit: PlusIcon,
  me: UserIcon,
  promote: MegaphoneIcon,
} as const;

function TabBar({ locale, screen }: { locale: Locale; screen: AppScreen }) {
  const strings = appUi(locale).nav;
  const order: AppScreen[] = ["browse", "submit", "me", "promote"];
  return (
    <nav
      aria-label={strings.label}
      className="sticky bottom-0 z-20 grid grid-cols-4 border-border border-t bg-card pb-[env(safe-area-inset-bottom)]"
    >
      {order.map((key) => {
        const Icon = screenIcons[key];
        const active = key === screen;
        return (
          <a
            key={key}
            href={localizePath(screenPaths[key], locale)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-1 py-2 text-[0.7rem] transition-colors",
              active ? "font-semibold text-primary-accent" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
            {strings[key]}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * The frame every screen renders inside: BackButton, the bottom tabs and the locale redirect.
 * Navigation between the four screens is ordinary links — Telegram puts its launch payload in the
 * URL fragment, so hash routing is not available to us.
 */
export function AppShell({
  locale,
  screen,
  webApp,
  children,
}: {
  locale: Locale;
  screen: AppScreen;
  webApp: TelegramWebApp | null;
  children: ReactNode;
}) {
  const [back, setBack] = useState<(() => void) | null>(null);
  const register = useCallback((handler: (() => void) | null) => setBack(() => handler), []);

  // The stored preference wins over the locale of the page Telegram happened to open.
  useEffect(() => {
    const wanted = preferredLocale(locale);
    if (wanted === locale) return;
    window.location.replace(localizePath(screenPaths[screen], wanted) + window.location.hash);
  }, [locale, screen]);

  useEffect(() => {
    if (!webApp) return;
    if (screen === "browse" && back === null) {
      webApp.BackButton.hide();
      return;
    }
    const handler =
      back ??
      (() => {
        window.location.href = localizePath(screenPaths.browse, locale);
      });
    webApp.BackButton.show();
    webApp.BackButton.onClick(handler);
    return () => webApp.BackButton.offClick(handler);
  }, [webApp, back, screen, locale]);

  return (
    <WebAppContext.Provider value={webApp}>
      <BackContext.Provider value={register}>
        <div className="flex min-h-dvh flex-col bg-background text-foreground">
          <main className="flex-1 pb-6">{children}</main>
          <TabBar locale={locale} screen={screen} />
        </div>
      </BackContext.Provider>
    </WebAppContext.Provider>
  );
}
