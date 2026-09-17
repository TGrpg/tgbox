import { dispatchStaleBuild, runPromotionMaintenance } from "@tgbox/core";
import { messages } from "./bot/i18n/index.ts";
import type { App } from "./bot/index.ts";
import { orderTarget } from "./bot/promote.ts";

// The hourly run has its own invocation: ~25 D1 calls worst case (15 slots)
// + up to 3 for the stale-build check + these messages < 50.
const MAX_NOTICES = 18;

const bilingual = (text: (m: ReturnType<typeof messages>) => string) =>
  `${text(messages("zh"))}\n\n${text(messages("en"))}`;

/** Hourly: ends expired promotions, reminds buyers a day before the end, drops stale orders. */
export async function runHourlyMaintenance(app: App, scheduledTime: number) {
  const result = await runPromotionMaintenance(app.core, scheduledTime);
  const notices = [
    ...result.expired.map((order) => ({
      userId: order.tgUserId,
      text: bilingual((m) => m.promote.expired(orderTarget(order))),
    })),
    ...result.expiringSoon.map((order) => ({
      userId: order.tgUserId,
      text: bilingual((m) =>
        m.promote.expiringSoon(orderTarget(order), order.endsAt ?? scheduledTime),
      ),
    })),
  ];
  // Notices over the cap are dropped: the promotion state is already recorded either way.
  const sent = await Promise.allSettled(
    notices.slice(0, MAX_NOTICES).map((notice) => app.api.sendMessage(notice.userId, notice.text)),
  );
  // Last line of defence: a change whose dispatch failed or was throttled away is published
  // within the hour instead of waiting for the next scheduled build.
  const rebuilt = await dispatchStaleBuild(app.core);
  return {
    expired: result.expired.length,
    expiringSoon: result.expiringSoon.length,
    deletedPending: result.deletedPending,
    notified: sent.filter((item) => item.status === "fulfilled").length,
    dropped: Math.max(0, notices.length - MAX_NOTICES),
    rebuilt,
  };
}
