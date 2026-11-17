import { dispatchStaleBuild, markDirtyAndDispatch, runPromotionMaintenance } from "@tgbox/core";
import {
  listEntriesNeedingTranslation,
  markOrdersReminded,
  setEntryTranslation,
  stampTranslationSkipped,
} from "@tgbox/db";
import type { Locale } from "@tgbox/shared";
import { GrammyError } from "grammy";
import { messages } from "./bot/i18n/index.ts";
import type { App } from "./bot/index.ts";
import { orderTarget } from "./bot/promote.ts";

// Free plan: 50 subrequests per invocation. The hourly run spends them on promotion maintenance,
// buyer notices and description translations, in that order of priority — translations take
// whatever is left (counted, not estimated), so a busy hour costs fewer translations.
const SUBREQUEST_BUDGET = 46;
/** Buyer messages per hour; the rest wait for the next hour (see `runPromotionMaintenance`). */
const MAX_NOTICES = 14;
/** One AI call + one D1 write per entry. */
const TRANSLATION_COST = 2;
/** The candidate query, the dirty/dispatch handling and the stale-build net at the end. */
const TRANSLATION_RESERVE = 7;

/** Telegram won't ever deliver this one (blocked, chat gone): retrying every hour is pointless. */
const undeliverable = (error: unknown) =>
  error instanceof GrammyError && (error.error_code === 400 || error.error_code === 403);
/** Per run, so the free Workers AI allocation lasts and the invocation stays inside its budget. */
const MAX_TRANSLATIONS = 8;

const TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
/** Too short to carry meaning (an emoji, a URL); too long to be worth a model call. */
const MIN_DESCRIPTION = 8;
const MAX_DESCRIPTION = 800;
// Like the refresh cron: content nobody is waiting for gets at most one build every 30 minutes.
const TRANSLATION_DISPATCH_INTERVAL_MS = 30 * 60_000;

const bilingual = (text: (m: ReturnType<typeof messages>) => string) =>
  `${text(messages("zh"))}\n\n${text(messages("en"))}`;

const CJK = /\p{Script=Han}/u;

/**
 * Which language the stored description is written in. The detected `lang` column decides when it
 * is one of ours; anything else (null, "ru", "ja"…) falls back to "has Han characters".
 */
export function translationSource(entry: { lang: string | null; description: string }): Locale {
  if (entry.lang === "zh") return "zh";
  if (entry.lang === "en") return "en";
  return CJK.test(entry.description) ? "zh" : "en";
}

type TranslationTally = { translated: number; skipped: number; failed: number };

/**
 * Fills in the missing half of each entry's bilingual description with Workers AI. The source text
 * stays in `description`; only the other language is generated, so one call covers one entry.
 */
async function translateDescriptions(
  app: App,
  now: number,
  limit: number,
): Promise<TranslationTally> {
  const tally: TranslationTally = { translated: 0, skipped: 0, failed: 0 };
  if (limit <= 0) return tally;
  const ai = app.env.AI;
  if (!ai) {
    console.warn("no AI binding: descriptions are not translated");
    return tally;
  }

  for (const entry of await listEntriesNeedingTranslation(app.db, limit, now)) {
    const text = entry.description.trim();
    if (text.length < MIN_DESCRIPTION || text.length > MAX_DESCRIPTION) {
      // Stamped, so an unusable description isn't offered again until it changes.
      console.log("translation skipped", entry.username, text.length);
      await stampTranslationSkipped(app.db, entry.id, now);
      tally.skipped++;
      continue;
    }
    const source = translationSource(entry);
    const locale: Locale = source === "zh" ? "en" : "zh";
    try {
      const result = await ai.run(TRANSLATION_MODEL, {
        text,
        source_lang: source,
        target_lang: locale,
      });
      const translated = "translated_text" in result ? (result.translated_text ?? "").trim() : "";
      if (!translated) {
        // An empty answer is the model's problem, not the entry's: leave it for the next run.
        console.error("translation returned nothing", entry.username);
        tally.failed++;
        continue;
      }
      await setEntryTranslation(app.db, { entryId: entry.id, locale, text: translated, now });
      tally.translated++;
    } catch (error) {
      // One bad entry must not cost the rest of the batch.
      console.error("translating failed", entry.username, error);
      tally.failed++;
    }
  }
  return tally;
}

/**
 * Hourly: ends expired promotions, reminds buyers a day before the end, drops stale orders.
 * `spent` reports what this cron invocation has used so far, this run included.
 */
export async function runHourlyMaintenance(
  app: App,
  scheduledTime: number,
  spent: () => number = () => 0,
) {
  const result = await runPromotionMaintenance(app.core, scheduledTime, {
    maxNotices: MAX_NOTICES,
  });
  const ended = await Promise.allSettled(
    result.expired.map((order) =>
      app.api.sendMessage(
        order.tgUserId,
        bilingual((m) => m.promote.expired(orderTarget(order))),
      ),
    ),
  );
  const reminded = await Promise.allSettled(
    result.expiringSoon.map((order) =>
      app.api.sendMessage(
        order.tgUserId,
        bilingual((m) => m.promote.expiringSoon(orderTarget(order), order.endsAt ?? scheduledTime)),
      ),
    ),
  );
  // A reminder that failed for a reason that may pass (rate limit, network) is sent next hour.
  await markOrdersReminded(
    app.db,
    result.expiringSoon.flatMap((order, index) => {
      const outcome = reminded[index];
      return outcome?.status === "fulfilled" || undeliverable(outcome?.reason) ? [order.id] : [];
    }),
    scheduledTime,
  );

  const left = SUBREQUEST_BUDGET - spent();
  const translations = await translateDescriptions(
    app,
    scheduledTime,
    Math.min(MAX_TRANSLATIONS, Math.floor((left - TRANSLATION_RESERVE) / TRANSLATION_COST)),
  );
  if (translations.translated > 0) {
    await markDirtyAndDispatch(app.core, {
      minIntervalMs: TRANSLATION_DISPATCH_INTERVAL_MS,
      onTransition: false,
    });
  }

  // Last line of defence: a change whose dispatch failed or was throttled away is published
  // within the hour instead of waiting for the next scheduled build.
  const rebuilt = await dispatchStaleBuild(app.core);
  return {
    expired: result.expired.length,
    expiringSoon: result.expiringSoon.length,
    deletedPending: result.deletedPending,
    notified: [...ended, ...reminded].filter((item) => item.status === "fulfilled").length,
    translated: translations.translated,
    translationsSkipped: translations.skipped,
    translationsFailed: translations.failed,
    rebuilt,
  };
}
