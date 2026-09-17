import { runRefresh } from "@tgbox/core";
import { webhookCallback } from "grammy";
import { createBot } from "./bot/index.ts";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
    const bot = createBot(env, {
      fetch: (input, init) => fetch(input, init),
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
    return webhookCallback(bot, "cloudflare-mod")(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runRefresh(env, controller.scheduledTime).then((result) =>
        // One line per run in Workers Logs: the only record of what the cron did.
        console.log("refresh", JSON.stringify(result)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
