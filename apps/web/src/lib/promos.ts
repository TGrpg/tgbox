import type { PromoView } from "@tgbox/shared";
import { hashText } from "./announcement.ts";

/** CSS backgrounds for paid banners (no external images), picked per banner id. */
export const promoBackgrounds = [
  "radial-gradient(120% 90% at 100% 0%, #7dd3fc 0%, transparent 55%), linear-gradient(135deg, #1d8fe0 0%, #2563eb 60%, #1e3a8a 100%)",
  "radial-gradient(90% 80% at 0% 100%, #fde68a 0%, transparent 60%), linear-gradient(140deg, #fb923c 0%, #f43f5e 70%, #be123c 100%)",
  "radial-gradient(100% 80% at 100% 100%, #a7f3d0 0%, transparent 55%), linear-gradient(135deg, #10b981 0%, #0d9488 55%, #115e59 100%)",
  "radial-gradient(110% 90% at 0% 0%, #c4b5fd 0%, transparent 55%), linear-gradient(150deg, #475569 0%, #1e293b 60%, #0f172a 100%)",
  "radial-gradient(100% 90% at 100% 0%, #fbcfe8 0%, transparent 55%), linear-gradient(135deg, #ec4899 0%, #d946ef 55%, #7e22ce 100%)",
];

export type PromoSlot =
  | {
      type: "paid";
      id: string;
      title: string;
      subtitle: string;
      href: string;
      /** Uploaded card image layered over the gradient; null keeps the gradient alone. */
      imageUrl: string | null;
      /** Ready-to-use CSS `background` value: image layer first, gradient behind it. */
      background: string;
    }
  /** "Ad space available" card linking to the bot's promote flow. */
  | { type: "placeholder"; id: string };

/**
 * Card images come from the admin's media host, but they end up inside a `style` attribute, so
 * only a plain https URL with no CSS-breaking characters is accepted.
 */
function safeImageUrl(url: string | null | undefined): string | null {
  return typeof url === "string" && /^https:\/\/[^\s"'()\\]+$/i.test(url) ? url : null;
}

/** Deep link that opens the bot's promotion purchase flow. */
export function promoteUrl(botUsername: string) {
  return `https://t.me/${botUsername}?start=promote`;
}

/**
 * Paid banners first (in snapshot order), then placeholders fill the remaining `slots`. With no paid
 * banner only `emptySlots` placeholders are shown, so the section isn't a wall of identical cards —
 * and when `showAdSlots` is off, nothing at all, so the whole sponsor block disappears rather than
 * advertising space the operator never sold. Paid banners are user-provided: only http(s) links
 * are kept.
 */
export function promoSlots(
  paid: PromoView[],
  slots: number,
  emptySlots: number,
  showAdSlots: boolean,
): PromoSlot[] {
  const paidSlots = paid
    .filter((promo) => /^https?:\/\//i.test(promo.href))
    .slice(0, slots)
    .map((promo): PromoSlot => {
      const gradient =
        promoBackgrounds[Number.parseInt(hashText(promo.id), 36) % promoBackgrounds.length] ?? "";
      const imageUrl = safeImageUrl(promo.imageUrl);
      return {
        type: "paid",
        id: promo.id,
        title: promo.title,
        subtitle: promo.subtitle,
        href: promo.href,
        imageUrl,
        // The gradient stays behind the image, so a broken or transparent image still reads.
        background: imageUrl ? `url("${imageUrl}") center/cover no-repeat, ${gradient}` : gradient,
      };
    });
  if (!showAdSlots) return paidSlots;
  const total = paidSlots.length === 0 ? Math.min(slots, emptySlots) : slots;
  const placeholders = Array.from(
    { length: total - paidSlots.length },
    (_, index): PromoSlot => ({ type: "placeholder", id: `slot-${paidSlots.length + index + 1}` }),
  );
  return [...paidSlots, ...placeholders];
}
