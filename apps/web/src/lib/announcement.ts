import { type AnnouncementView, type PromoView, promoClickUrl } from "@tgbox/shared";

/** Small stable string hash (base 36) for localStorage keys. */
export function hashText(text: string): string {
  return [...text]
    .reduce((hash, char) => (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) >>> 0, 7)
    .toString(36);
}

/**
 * A paid announcement bar in the shape of the admin's announcement: one text for both locales, and
 * the click-counting link (already locale-neutral, so the bar must not localize it).
 */
export function paidAnnouncement(promo: PromoView): AnnouncementView {
  const text = `${promo.title} · ${promo.subtitle}`;
  return { zh: text, en: text, href: promoClickUrl(promo.id) };
}

/** Dismissal key: any edit to the text or link yields a new key, so the new announcement shows again. */
export function announcementKey(announcement: AnnouncementView): string {
  return `announcement:${hashText(JSON.stringify([announcement.zh, announcement.en, announcement.href]))}`;
}
