import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { EllipsisIcon, MoonIcon, ShieldAlertIcon, SunIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/coss/ui/button.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { sessionQueryOptions } from "@/functions/session.ts";
import { cn } from "@/lib/cn.ts";
import {
  applyTelegramTheme,
  isTelegram,
  loadTelegramWebApp,
  type TelegramWebApp,
} from "@/lib/telegram.ts";
import { useTheme } from "@/lib/theme.ts";
import { navItems } from "./nav.ts";

export function AppShell({ children }: { children: ReactNode }) {
  const session = useQuery(sessionQueryOptions());
  const inTelegram = useTelegramBridge();

  if (session.isError) return <Unauthorized />;

  return (
    <div className="min-h-dvh bg-background md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar px-3 py-4 md:flex">
        <Link to="/" className="mb-6 flex items-center gap-2 px-3 font-semibold text-lg">
          <span className="size-2.5 rounded-full bg-brand-dot" aria-hidden />
          TGbox · 后台
        </Link>
        <nav className="flex flex-col gap-1" aria-label="主导航">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground"
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-8">
          <span className="font-semibold md:hidden">TGbox · 后台</span>
          <div className="ml-auto flex items-center gap-2">
            {session.data ? (
              <span
                className="max-w-48 truncate text-muted-foreground text-sm"
                title={session.data.via}
              >
                {session.data.actor}
              </span>
            ) : (
              <Skeleton className="h-5 w-32" />
            )}
            {!inTelegram && <ThemeToggle />}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 md:px-8 md:pb-10">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="切换主题">
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const secondary = navItems.filter((item) => !item.primary);
  const secondaryActive = secondary.some((item) => location.pathname.startsWith(item.to));

  useEffect(() => {
    if (location.pathname) setMoreOpen(false);
  }, [location.pathname]);

  const itemClass =
    "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground data-[status=active]:text-primary-accent";

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="主导航"
    >
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16 }}
            className="absolute right-2 bottom-full mb-2 flex min-w-40 flex-col rounded-xl border bg-popover p-1 shadow-float"
          >
            {secondary.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm data-[status=active]:bg-accent data-[status=active]:text-accent-foreground"
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex">
        {navItems
          .filter((item) => item.primary)
          .map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className={itemClass}
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </Link>
          ))}
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          data-status={secondaryActive ? "active" : undefined}
          className={cn(itemClass, "cursor-pointer")}
        >
          <EllipsisIcon className="size-5" aria-hidden />
          更多
        </button>
      </div>
    </nav>
  );
}

/** Inside Telegram: apply theme colors and drive the native BackButton from router history. */
function useTelegramBridge() {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const location = useLocation();
  const router = useRouter();
  const isRoot = location.pathname === "/";

  useEffect(() => {
    if (!isTelegram()) return;
    void loadTelegramWebApp().then((loaded) => {
      if (!loaded) return;
      loaded.ready();
      loaded.expand();
      applyTelegramTheme(loaded);
      loaded.onEvent("themeChanged", () => applyTelegramTheme(loaded));
      setWebApp(loaded);
    });
  }, []);

  useEffect(() => {
    if (!webApp) return;
    const back = () => router.history.back();
    if (isRoot) webApp.BackButton.hide();
    else webApp.BackButton.show();
    webApp.BackButton.onClick(back);
    return () => webApp.BackButton.offClick(back);
  }, [webApp, isRoot, router]);

  return webApp !== null;
}

function Unauthorized() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <ShieldAlertIcon className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="font-semibold text-xl">无权访问</h1>
        <p className="text-muted-foreground text-sm">
          请通过 Cloudflare Access 登录，或在 Telegram 中从机器人菜单打开管理后台。
        </p>
      </div>
    </div>
  );
}
