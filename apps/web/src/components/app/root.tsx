import type { Locale } from "@tgbox/shared";
import type { ReactNode } from "react";
import { appUi } from "@/i18n/ui-app.ts";
import { BrowseScreen } from "./browse.tsx";
import { MeScreen } from "./me.tsx";
import { PromoteScreen } from "./promote.tsx";
import {
  type AppScreen,
  AppShell,
  LoadingScreen,
  OutsideTelegram,
  useTelegramBridge,
} from "./shell.tsx";
import { SubmitScreen } from "./submit.tsx";

export type AppRootProps = {
  locale: Locale;
  screen: AppScreen;
  /** Directory that holds `pagefind.js` (R2 public URL in production, `/pagefind` locally). */
  pagefindUrl: string;
  siteUrl: string;
  botUrl: string;
};

/**
 * The island each of the four prerendered pages mounts. Screens never render on the server, so
 * everything below this point may read `window` freely.
 */
export default function AppRoot({ locale, screen, pagefindUrl, siteUrl, botUrl }: AppRootProps) {
  const telegram = useTelegramBridge();
  const webApp = telegram.status === "inside" ? telegram.webApp : null;
  const strings = appUi(locale);

  let content: ReactNode;
  if (telegram.status === "pending") {
    content = <LoadingScreen label={strings.common.loading} />;
  } else if (telegram.status === "outside" && screen !== "browse") {
    // Browsing works without a launch payload; everything signed does not.
    content = <OutsideTelegram locale={locale} botUrl={botUrl} />;
  } else if (screen === "browse") {
    content = <BrowseScreen locale={locale} pagefindUrl={pagefindUrl} siteUrl={siteUrl} />;
  } else if (screen === "submit") {
    content = <SubmitScreen locale={locale} />;
  } else if (screen === "me") {
    content = <MeScreen locale={locale} botUrl={botUrl} />;
  } else {
    content = <PromoteScreen locale={locale} />;
  }

  return (
    <AppShell locale={locale} screen={screen} webApp={webApp}>
      {content}
    </AppShell>
  );
}
