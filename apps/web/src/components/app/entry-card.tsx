import type { EntryKind, EntryProductKind, Locale } from "@tgbox/shared";
import { ExternalLinkIcon, Share2Icon } from "lucide-react";
import { Button } from "@/components/coss/ui/button";
import { appUi } from "@/i18n/ui-app.ts";
import { cn } from "@/lib/cn.ts";
import { formatNumber } from "@/lib/format.ts";
import { shareEntry, type TelegramWebApp } from "./telegram.ts";

export type BrowseItem = {
  username: string;
  kind: EntryKind;
  title: string;
  members: number | null;
  avatarUrl: string | null;
  /** Search results don't carry it; the browse list does. */
  promo?: EntryProductKind | null;
};

/** Links must not navigate the webview away from the app; Telegram opens them itself. */
export function openInTelegram(webApp: TelegramWebApp | null, username: string) {
  const url = `https://t.me/${username}`;
  if (webApp) webApp.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export function EntryCard({
  entry,
  locale,
  webApp,
  siteUrl,
}: {
  entry: BrowseItem;
  locale: Locale;
  webApp: TelegramWebApp | null;
  siteUrl: string;
}) {
  const strings = appUi(locale);
  const detailUrl = `${siteUrl}${locale === "en" ? "/en" : ""}/detail/${entry.username}/`;
  return (
    // Same look as a promoted card on the site: every tier is tinted and tagged alike.
    <li
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border bg-card p-3",
        entry.promo && "border-warning-foreground/35 bg-warning/50",
      )}
    >
      <img
        src={entry.avatarUrl ?? "/images/default-avatar.svg"}
        alt=""
        width="44"
        height="44"
        loading="lazy"
        className="size-11 shrink-0 rounded-full bg-muted object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-semibold text-sm">
          <span className="truncate" dir="auto">
            {entry.title}
          </span>
          {entry.promo && (
            <span className="shrink-0 rounded-md bg-warning-foreground px-1.5 text-[0.675rem] text-warning leading-4">
              {strings.browse.promoted}
            </span>
          )}
        </p>
        <p className="truncate text-muted-foreground text-xs">
          @{entry.username}
          {entry.members !== null && (
            <>
              {" · "}
              {formatNumber(entry.members, locale, { compact: true })} {strings.members[entry.kind]}
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={strings.browse.share}
          onClick={() =>
            shareEntry(
              webApp,
              `@${entry.username}`,
              `https://t.me/share/url?${new URLSearchParams({ url: detailUrl, text: entry.title })}`,
            )
          }
        >
          <Share2Icon aria-hidden />
        </Button>
        <Button size="sm" onClick={() => openInTelegram(webApp, entry.username)}>
          <ExternalLinkIcon aria-hidden />
          {strings.browse.open}
        </Button>
      </div>
    </li>
  );
}
