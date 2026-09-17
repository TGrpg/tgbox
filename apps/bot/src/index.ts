import { runRefresh } from "@tgbox/core";
import { webhookCallback } from "grammy";
import { createApp, createBot } from "./bot/index.ts";
import { handleCryptoPayWebhook } from "./cryptopay.ts";
import { runHourlyMaintenance } from "./maintenance.ts";

/** Second cron trigger in wrangler.jsonc; a separate invocation with its own subrequest budget. */
const HOURLY_CRON = "0 * * * *";

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
      return;
    }
    ctx.waitUntil(
      runRefresh(env, controller.scheduledTime).then((result) =>
        // One line per run in Workers Logs: the only record of what the cron did.
        console.log("refresh", JSON.stringify(result)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
