import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  ScriptOnce,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/coss/ui/toast.tsx";
import { AppShell } from "@/components/shell/app-shell.tsx";
import { THEME_SCRIPT } from "@/lib/theme.ts";
import appCss from "@/styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "robots", content: "noindex" },
      { title: "TGbox · 管理后台" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider position="top-center">
        <AppShell>
          <Outlet />
        </AppShell>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ScriptOnce>{THEME_SCRIPT}</ScriptOnce>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
