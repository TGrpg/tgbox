import type { BannerContent, ProductKind } from "./settings.ts";

/**
 * Paid promotions are clicked through `/r/<promotion id>` so the owner (and the advertiser) can
 * see what an ad delivered. Everything here is pure: the redirect route reads the promotion from
 * D1, asks `promoRedirect` what to do, and does it.
 */

/** Click-counting link for a paid promo card. Relative, so it works on both locales. */
export const promoClickUrl = (promoId: string) => `/r/${promoId}`;

/** What a promotion sends the visitor to: the banner's own link, or the pinned entry on Telegram. */
export function promoTarget(promotion: {
  kind: ProductKind;
  entryUsername: string | null;
  banner: BannerContent | null;
}) {
  if (promotion.kind === "pin") {
    return promotion.entryUsername ? `https://t.me/${promotion.entryUsername}` : null;
  }
  const href = promotion.banner?.href;
  // Banner links are advertiser-supplied: never redirect to javascript:, data: or a relative path.
  return href && /^https?:\/\//i.test(href) ? href : null;
}

/**
 * Crawlers, link unfurlers and uptime checks follow promo links without a human behind them.
 * They still get the redirect — just not a click.
 */
export const isBotTraffic = (method: string, userAgent: string | null) =>
  method === "HEAD" || (userAgent !== null && /bot|crawler|spider|preview/i.test(userAgent));

export type PromoRedirect = {
  /** Where to send the visitor; "/" whenever the promotion is unknown, expired or unusable. */
  location: string;
  /** False for bot traffic and for promotions that are not currently running. */
  record: boolean;
};

/**
 * Decides one click. A promotion counts only while it is actually on the site
 * (`starts_at <= now < ends_at`); anything else quietly goes home.
 */
export function promoRedirect(input: {
  promotion: {
    kind: ProductKind;
    entryUsername: string | null;
    banner: BannerContent | null;
    startsAt: number;
    endsAt: number;
  } | null;
  now: number;
  method: string;
  userAgent: string | null;
}): PromoRedirect {
  const { promotion, now } = input;
  if (!promotion || promotion.startsAt > now || promotion.endsAt <= now) {
    return { location: "/", record: false };
  }
  const location = promoTarget(promotion);
  if (location === null) return { location: "/", record: false };
  return { location, record: !isBotTraffic(input.method, input.userAgent) };
}
