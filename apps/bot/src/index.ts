import { dispatchHeldBuild, runDueBroadcasts, runRefresh } from "@tgbox/core";
import { webhookCallback } from "grammy";
import { createApp, createBot } from "./bot/index.ts";
import { handleCryptoPayWebhook } from "./cryptopay.ts";
import { DIGEST_UTC_HOUR, runDailyDigest } from "./digest.ts";
import { runHourlyMaintenance } from "./maintenance.ts";
import { countSubrequests } from "./subrequests.ts";
import { runUsdtWatch } from "./usdt-watch.ts";

/** Second cron trigger in wrangler.jsonc; a separate invocation with its own subrequest budget. */
const HOURLY_CRON = "0 * * * *";

/**
 * What USDT and broadcast may use together on the 5-minute tick: broadcast sends at most this
 * minus what USDT already spent, leaving the rest of the budget to refresh.
 */
const BROADCAST_BUDGET = 25;

// Wrapped: workerd throws "Illegal invocation" when fetch is called as a method of another object.
const deps = (ctx: ExecutionContext, now?: () => number) => ({
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  waitUntil: (promise: Promise<unknown>) => ctx.waitUntil(promise),
  now,
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/cryptopay/webhook") {
      // Authenticated by the Crypto Pay signature instead of the Telegram secret token.
      return handleCryptoPayWebhook(createApp(env, deps(ctx)), request);
    }
    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
    const bot = createBot(env, deps(ctx));
    return webhookCallback(bot, "cloudflare-mod")(request);
  },

  async scheduled(controller, env, ctx) {
    // Every job of an invocation shares one counted binding and fetch, and runs without
    // `waitUntil` so its background sends are finished (and counted) before the next job sizes
    // itself on what is left.
    const counter = countSubrequests(env.DB, (input, init) => fetch(input, init));
    const app = createApp(
      { ...env, DB: counter.db },
      {
        fetch: counter.fetch,
        now: () => controller.scheduledTime,
      },
    );
    if (controller.cron === HOURLY_CRON) {
      ctx.waitUntil(
        (async () => {
          if (new Date(controller.scheduledTime).getUTCHours() === DIGEST_UTC_HOUR) {
            await runDailyDigest(app, controller.scheduledTime)
              .then((result) => console.log("digest", JSON.stringify(result)))
              .catch((error: unknown) => console.error("daily digest failed", error));
          }
          const result = await runHourlyMaintenance(app, controller.scheduledTime, counter.used);
          console.log("maintenance", JSON.stringify({ ...result, subrequests: counter.used() }));
        })(),
      );
      return;
    }
    // The 5-minute tick carries four jobs sharing one 50-subrequest budget. First a person's change
    // whose build was held back (one D1 read when none is). USDT next: a single D1 read when no
    // order is awaiting a transfer. Then a batch of any broadcast the admin
    // left running (its page drives it faster while open). Whatever both spend is handed to the
    // refresh batch, which processes fewer entries instead of overrunning.
    ctx.waitUntil(
      (async () => {
        await dispatchHeldBuild(app.core).catch((error: unknown) => {
          console.error("held build dispatch failed", error);
        });
        await runUsdtWatch(app).catch((error: unknown) => {
          console.error("usdt watch failed", error);
        });
        await runDueBroadcasts(app.core, BROADCAST_BUDGET - counter.used()).catch(
          (error: unknown) => {
            console.error("broadcast failed", error);
          },
        );
        const result = await runRefresh(env, controller.scheduledTime, undefined, counter.used());
        // One line per run in Workers Logs: the only record of what the cron did.
        console.log("refresh", JSON.stringify(result));
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
