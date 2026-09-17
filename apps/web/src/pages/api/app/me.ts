import { settingsFromRows } from "@tgbox/core";
import { loadAppOverview } from "@tgbox/db";
import type { AppMe, AppOrder, Locale } from "@tgbox/shared";
import type { APIRoute } from "astro";
import { appJson, authenticateApp } from "@/lib/app-auth.ts";

export const prerender = false;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything the Mini App needs to open: the user, their submissions, their orders and what they
 * are still allowed to submit today. One Worker request and one `db.batch` — the whole budget for
 * an app session, because every other screen is served from static files.
 */
export const GET: APIRoute = async ({ request }) => {
  const auth = await authenticateApp(request);
  if (!auth.ok) return auth.response;
  const { user, db } = auth.session;

  const now = Date.now();
  const overview = await loadAppOverview(db, { tgUserId: user.id, since: now - DAY_MS });
  const { bot } = settingsFromRows(overview.settingsRows);
  const locale = overview.locale ?? localeOf(user.languageCode);

  const orders: AppOrder[] = overview.orders.map((order) => {
    const product = overview.productNames.get(order.productId);
    return {
      id: order.id,
      kind: order.kind,
      productName: (locale === "en" ? product?.nameEn : product?.nameZh) ?? `#${order.productId}`,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      createdAt: order.createdAt,
      startsAt: order.startsAt,
      endsAt: order.endsAt,
      targetUsername: order.targetUsername,
      clicks: overview.clicksByOrder.get(order.id) ?? 0,
    };
  });

  const body: AppMe = {
    user: { id: user.id, locale },
    submissions: overview.submissions,
    orders,
    limits: {
      submitDailyLimit: bot.submitDailyLimit,
      submittedToday: overview.submittedToday,
      submissionsOpen: bot.submissionsOpen,
    },
  };
  return appJson(body);
};

/** No stored preference yet: follow the Telegram client's language, exactly as the bot does. */
const localeOf = (languageCode: string | null): Locale =>
  languageCode?.toLowerCase().startsWith("en") ? "en" : "zh";
