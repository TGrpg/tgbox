import { runDueBroadcasts, runRefresh } from "@tgbox/core";
import { webhookCallback } from "grammy";
import { createApp, createBot } from "./bot/index.ts";
import { handleCryptoPayWebhook } from "./cryptopay.ts";
import { DIGEST_UTC_HOUR, runDailyDigest } from "./digest.ts";
import { runHourlyMaintenance } from "./maintenance.ts";
import { runUsdtWatch } from "./usdt-watch.ts";

/** Second cron trigger in wrangler.jsonc; a separate invocation with its own subrequest budget. */
const HOURLY_CRON = "0 * * * *";

/** Broadcast messages the 5-minute tick may send, leaving the rest of its budget to refresh. */
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
    if (controller.cron === HOURLY_CRON) {
      const app = createApp(
        env,
        deps(ctx, () => controller.scheduledTime),
      );
      ctx.waitUntil(
        runHourlyMaintenance(app, controller.scheduledTime).then((result) =>
          console.log("maintenance", JSON.stringify(result)),
        ),
      );
      if (new Date(controller.scheduledTime).getUTCHours() === DIGEST_UTC_HOUR) {
        ctx.waitUntil(
          runDailyDigest(app, controller.scheduledTime)
            .then((result) => console.log("digest", JSON.stringify(result)))
            .catch((error: unknown) => console.error("daily digest failed", error)),
        );
      }
      return;
    }
    // The 5-minute tick carries three jobs sharing one 50-subrequest budget. USDT first: it is a
    // single D1 read when no order is awaiting a transfer. Then a batch of any broadcast the admin
    // left running (its page drives it faster while open). Whatever both spend is handed to the
    // refresh batch, which processes fewer entries instead of overrunning.
    ctx.waitUntil(
      (async () => {
        const app = createApp(
          env,
          deps(ctx, () => controller.scheduledTime),
        );
        const spent = await runUsdtWatch(app).catch((error: unknown) => {
          console.error("usdt watch failed", error);
          return 0;
        });
        const broadcast = await runDueBroadcasts(app.core, BROADCAST_BUDGET).catch(
          (error: unknown) => {
            console.error("broadcast failed", error);
            return 0;
          },
        );
        const result = await runRefresh(
          env,
          controller.scheduledTime,
          undefined,
          spent + broadcast,
        );
        // One line per run in Workers Logs: the only record of what the cron did.
        console.log("refresh", JSON.stringify(result));
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
