import type { BannerContent } from "@tgbox/shared";
import { ExternalLinkIcon, PinIcon } from "lucide-react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { cn } from "@/lib/cn.ts";

const hostOf = (href: string) => {
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return href;
  }
};

/** Compact look-alike of the home banner card. */
export function BannerPreview({
  banner,
  className,
}: {
  banner: Partial<BannerContent>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 max-w-72 flex-col gap-0.5 rounded-xl border bg-muted/40 px-3 py-2",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate font-medium text-sm">{banner.title || "标题"}</span>
        <Badge variant="outline" size="sm">
          广告
        </Badge>
      </div>
      <span className="truncate text-muted-foreground text-xs">{banner.subtitle || "副标题"}</span>
      {banner.href && (
        <a
          href={banner.href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-w-0 items-center gap-1 text-info-foreground text-xs hover:underline"
        >
          <span className="truncate">{hostOf(banner.href)}</span>
          <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
        </a>
      )}
    </div>
  );
}

/** What a promotion shows: the pinned entry or the banner card. */
export function PromotionContent({
  username,
  banner,
}: {
  username: string | null;
  banner: BannerContent | null;
}) {
  if (banner) return <BannerPreview banner={banner} />;
  if (!username) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={`https://t.me/${username}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 font-mono text-sm hover:underline"
    >
      <PinIcon className="size-3.5 text-warning-foreground" aria-hidden />@{username}
    </a>
  );
}
