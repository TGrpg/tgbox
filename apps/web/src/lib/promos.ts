import type { Locale, PromoView } from "@tgbox/shared";
import type { Promo } from "../data/promos.ts";
import { localizePath } from "../i18n/locale.ts";
import { hashText } from "./announcement.ts";

const fallbackBackground = "linear-gradient(135deg, #1d8fe0 0%, #2563eb 60%, #1e3a8a 100%)";

export interface PromoCard {
  id: string;
  /** Paid banner: "Ad" badge, megaphone icon, `rel="sponsored"`. */
  sponsored: boolean;
  /** Corner label for house promos; paid cards show the localized "Ad" label instead. */
  badge: string | null;
  title: string;
  subtitle: string;
  href: string;
  external: boolean;
  icon: Promo["icon"] | "ad";
  background: string;
}

/**
 * Paid banners first (in snapshot order), then house promos fill up to `limit`. Paid banners are
 * user-provided: only http(s) links are kept, and each gets a house gradient picked from its id.
 */
export function mergePromos(
  paid: PromoView[],
  house: Promo[],
  locale: Locale,
  limit: number,
): PromoCard[] {
  const paidCards = paid
    .filter((promo) => /^https?:\/\//i.test(promo.href))
    .map(
      (promo): PromoCard => ({
        id: promo.id,
        sponsored: true,
        badge: null,
        title: promo.title,
        subtitle: promo.subtitle,
        href: promo.href,
        external: true,
        icon: "ad",
        background:
          house[Number.parseInt(hashText(promo.id), 36) % house.length]?.background ??
          fallbackBackground,
      }),
    );
  const houseCards = house.map((promo): PromoCard => {
    const external = /^https?:/.test(promo.href);
    return {
      id: promo.id,
      sponsored: false,
      badge: promo.badge[locale],
      title: promo.title[locale],
      subtitle: promo.subtitle[locale],
      href: external ? promo.href : localizePath(promo.href, locale),
      external,
      icon: promo.icon,
      background: promo.background,
    };
  });
  return [...paidCards, ...houseCards].slice(0, limit);
}
