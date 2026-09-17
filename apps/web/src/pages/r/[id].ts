import { env } from "cloudflare:workers";
import { clickDay, createDb, getPromotion, recordClick } from "@tgbox/db";
import { promoRedirect } from "@tgbox/shared";
import type { APIRoute } from "astro";

/**
 * Click counter for paid promotions — the only place public traffic is allowed to reach a Worker.
 * Everything else on the site is a static asset (see `.agents/cloudflare.md`), but a click has to
 * be observed as it happens: the number is what an advertiser is shown for the money they paid,
 * and the site is rebuilt only every few hours, so it cannot be derived from the snapshot.
 *
 * Cost: one Worker request, one D1 read and one D1 write per click — 100k requests/day and 100k
 * rows written/day on the free plan, i.e. clicks are the budget, not the pages. Nothing about the
 * visitor is read or stored: no IP, no referrer, no cookie, only a per-day counter per promotion.
 */
export const prerender = false;

const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    // A cached redirect would be both wrong (promotions end) and uncounted.
    headers: { location, "cache-control": "no-store" },
  });

/**
 * `ALL` rather than `GET`: HEAD and the odd POST from a scanner must be answered too, and the
 * method is what tells a link unfurler apart from a reader.
 */
export const ALL: APIRoute = async ({ params, request }) => {
  const promotionId = Number(params.id);
  if (!Number.isSafeInteger(promotionId) || promotionId <= 0) return redirect("/");

  const db = createDb(env.DB);
  const now = Date.now();
  const promotion = await getPromotion(db, promotionId);
  const decision = promoRedirect({
    promotion: promotion ?? null,
    now,
    method: request.method,
    userAgent: request.headers.get("user-agent"),
  });
  // Awaited, not deferred: losing the write would mean under-reporting a paid placement.
  if (decision.record) await recordClick(db, { promotionId, day: clickDay(now) });
  return redirect(decision.location);
};
