import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { type CoreContext, setCredential } from "@tgbox/core";
import { createDb, syncTaxonomy, upsertSetting } from "@tgbox/db";
import { type BotSettings, type PaymentSettings, settingsDefaults } from "@tgbox/shared";
import { vi } from "vitest";
import firstPostHtml from "../../../../packages/telegram/fixtures/channel-first-post.html?raw";
import postsHtml from "../../../../packages/telegram/fixtures/channel-posts.html?raw";
import bannedHtml from "../../../../packages/telegram/fixtures/profile-banned.html?raw";
import botHtml from "../../../../packages/telegram/fixtures/profile-bot.html?raw";
import channelHtml from "../../../../packages/telegram/fixtures/profile-channel.html?raw";
import groupHtml from "../../../../packages/telegram/fixtures/profile-group.html?raw";
import notFoundHtml from "../../../../packages/telegram/fixtures/profile-not-found.html?raw";
import userHtml from "../../../../packages/telegram/fixtures/profile-user.html?raw";
import worker from "../../src/index.ts";

export const ADMIN = { id: 900, is_bot: false, first_name: "Alice", username: "alice_admin" };
export const ADMIN_2 = { id: 901, is_bot: false, first_name: "Bob" };
export const ADMIN_CHAT_ID = -100500;

/** What the fake Workers AI binding was asked to do, and what it answers. */
export type AiCall = { model: string; inputs: Record<string, unknown> };

/** Never the real Workers AI: tests record the calls and script the answers. */
function fakeAi(calls: AiCall[], respond: () => { translated_text?: string }) {
  return {
    run: async (model: string, inputs: Record<string, unknown>) => {
      calls.push({ model, inputs });
      return respond();
    },
  };
}

const aiCalls: AiCall[] = [];
let aiRespond: () => { translated_text?: string } = () => ({ translated_text: "translated" });

// Vars are empty in wrangler.jsonc (typed as ""), so tests layer their own values on top.
const testEnv: Env = Object.assign({}, env, {
  ADMIN_IDS: `${ADMIN.id}, ${ADMIN_2.id}`,
  ADMIN_CHAT_ID: String(ADMIN_CHAT_ID),
  GITHUB_REPO: "owner/tgbox",
  SITE_URL: "https://tgbox.test",
  R2_PUBLIC_URL: "https://media.tgbox.test",
  AI: fakeAi(aiCalls, () => aiRespond()) as unknown as Ai,
});

export const db = createDb(env.DB);

/** Core context for arranging state the way the admin app would. */
export const core: CoreContext = {
  db,
  fetch: (input, init) => fetch(input, init),
  now: Date.now,
  config: { GITHUB_REPO: "", GITHUB_DISPATCH_TOKEN: "", SETTINGS_KEY: env.SETTINGS_KEY },
};

export const CRYPTO_PAY_TOKEN = "12345:crypto-test-token";

export async function setBotSettings(patch: Partial<BotSettings>) {
  const value = JSON.stringify({ ...settingsDefaults.bot, ...patch });
  await upsertSetting(db, "bot", value, Date.now());
}

export async function setPaymentSettings(patch: Partial<PaymentSettings>) {
  const value = JSON.stringify({ ...settingsDefaults.payments, ...patch });
  await upsertSetting(db, "payments", value, Date.now());
}

/** Enables USDT payments with a stored (encrypted) Crypto Pay token. */
export async function enableCryptoPay() {
  await setPaymentSettings({ cryptoPayEnabled: true, cryptoPayNetwork: "testnet" });
  await setCredential(core, { key: "cryptopay_token", value: CRYPTO_PAY_TOKEN, actor: "system" });
}

/** hex(HMAC-SHA256(body, key = SHA-256(token))), as Crypto Pay signs webhooks. */
export async function cryptoPaySignature(body: string, token = CRYPTO_PAY_TOKEN) {
  const secret = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Worker handlers type requests with incoming cf properties (pattern from the vitest-pool-workers docs).
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export type TelegramCall = { method: string; payload: Record<string, unknown> };

/** Profile fixture by username; anything unlisted is served as an active channel. */
const profiles: Record<string, string> = {
  grammyjs: groupHtml,
  botfather: botHtml,
  nikolai: userHtml,
  zzqq_not_exist_987654: notFoundHtml,
  qassambrigades: bannedHtml,
};

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/** Fakes api.telegram.org, t.me and api.github.com, and syncs the taxonomy into D1. */
export async function startHarness() {
  // Storage persists between tests in a file, so each test starts from empty mutable tables.
  await env.DB.batch(
    [
      "submissions",
      "bot_drafts",
      "blacklist",
      "entries",
      "entry_stats",
      "entry_tags",
      "entries_fts",
      "site_state",
      "settings",
      "credentials",
      "bot_chats",
      "orders",
      "promotions",
      "user_prefs",
      "support_threads",
      "hidden_posts",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  // R2 persists between tests as well, and order ids restart at 1 in every test.
  const promos = await env.MEDIA.list({ prefix: "promos/" });
  if (promos.objects.length > 0) await env.MEDIA.delete(promos.objects.map((row) => row.key));
  await syncTaxonomy(db);
  const telegram: TelegramCall[] = [];
  const dispatches: { url: string; body: string }[] = [];
  const tme: string[] = [];
  const cryptoPay: { url: string; body: Record<string, unknown> }[] = [];
  let nextMessageId = 5000;
  let nextTopicId = 100;
  // Bot API methods that must answer with an error once (topic closed, user blocked the bot…).
  const forcedErrors = new Map<string, string>();
  // While set, t.me requests stay pending until the test calls the release function.
  let tmeGate: Promise<void> | null = null;
  // While true, the Bot API rejects every call like it does for a user who blocked the bot.
  let telegramRejects = false;
  // Telegram file downloads (banner images): requested paths and the response for them.
  const files: string[] = [];
  let fileResponse: () => Response = () => new Response("image-bytes", { status: 200 });
  // The static site (SITE_URL): requested paths and the response for them.
  const site: string[] = [];
  let siteResponse: () => Response = () => new Response("Not found", { status: 404 });

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.hostname === "api.telegram.org") {
      // File downloads (`/file/bot<token>/<path>`) are not Bot API method calls.
      if (url.pathname.includes("/file/bot")) {
        files.push(url.pathname);
        return fileResponse();
      }
      const method = url.pathname.split("/").pop() ?? "";
      const payload: Record<string, unknown> = body ? JSON.parse(body) : {};
      telegram.push({ method, payload });
      const forced = forcedErrors.get(method);
      if (forced !== undefined) {
        forcedErrors.delete(method);
        return Response.json({ ok: false, error_code: 400, description: forced }, { status: 400 });
      }
      if (telegramRejects) {
        return Response.json(
          { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
          { status: 403 },
        );
      }
      const result =
        method === "sendMessage" || method === "sendInvoice"
          ? {
              message_id: ++nextMessageId,
              date: 0,
              chat: { id: payload.chat_id, type: "private" },
              text: payload.text,
            }
          : method === "createForumTopic"
            ? { message_thread_id: ++nextTopicId, name: payload.name, icon_color: 0 }
            : method === "copyMessage"
              ? { message_id: ++nextMessageId }
              : method === "getFile"
                ? { file_id: payload.file_id, file_unique_id: "u1", file_path: "photos/file_1.jpg" }
                : true;
      return Response.json({ ok: true, result });
    }
    if (url.hostname === "t.me") {
      tme.push(url.pathname);
      if (tmeGate) await tmeGate;
      const [first = "", , third] = url.pathname.split("/").filter(Boolean);
      if (first === "s") {
        return new Response(third ? firstPostHtml : postsHtml, { status: 200 });
      }
      return new Response(profiles[first.toLowerCase()] ?? channelHtml, { status: 200 });
    }
    if (url.hostname === "pay.crypt.bot" || url.hostname === "testnet-pay.crypt.bot") {
      cryptoPay.push({ url: url.href, body: body ? JSON.parse(body) : {} });
      return Response.json({
        ok: true,
        result: { invoice_id: 777, bot_invoice_url: "https://t.me/CryptoTestnetBot?start=IVtest" },
      });
    }
    if (url.hostname === "tgbox.test") {
      site.push(url.pathname);
      return siteResponse();
    }
    if (url.hostname === "api.github.com") {
      dispatches.push({ url: url.href, body });
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${url.href}`);
  });

  let updateId = 1;
  let callbackId = 1;

  /** Delivers an update; `done` settles once the work handed to `ctx.waitUntil` has finished. */
  async function start(update: Record<string, unknown>) {
    const request = new IncomingRequest("https://bot.test/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
      body: JSON.stringify({ update_id: updateId++, ...update }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, testEnv, ctx);
    return { response, done: waitOnExecutionContext(ctx) };
  }

  async function send(update: Record<string, unknown>) {
    const { response, done } = await start(update);
    await done;
    return response;
  }

  function message(
    from: From,
    text: string,
    chat: Record<string, unknown> = { id: from.id, type: "private" },
    extra: Record<string, unknown> = {},
  ) {
    return {
      message: {
        message_id: updateId,
        date: 0,
        chat,
        from,
        text,
        ...commandEntities(text),
        ...extra,
      },
    };
  }

  type From = {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
    language_code?: string;
  };

  aiCalls.length = 0;
  aiRespond = () => ({ translated_text: "translated" });

  return {
    telegram,
    dispatches,
    tme,
    cryptoPay,
    site,
    files,
    /** Workers AI calls, in order. */
    aiCalls,
    /** Scripts what the fake Workers AI binding answers (or throws). */
    answerAi: (respond: () => { translated_text?: string }) => {
      aiRespond = respond;
    },
    /** Serves the next Telegram file download. */
    serveFile: (respond: () => Response) => {
      fileResponse = respond;
    },
    /** Serves the static site (SITE_URL) responses. */
    serveSite: (respond: () => Response) => {
      siteResponse = respond;
    },
    /** Delivers a raw Telegram update (payments, chat member changes…). */
    update: (update: Record<string, unknown>) => send(update),
    /** POSTs a Crypto Pay webhook body with the given signature header. */
    cryptoPayWebhook: async (body: string, signature: string | null) => {
      const headers: Record<string, string> = {};
      if (signature !== null) headers["crypto-pay-api-signature"] = signature;
      const ctx = createExecutionContext();
      const response = await worker.fetch(
        new IncomingRequest("https://bot.test/cryptopay/webhook", {
          method: "POST",
          headers,
          body,
        }),
        testEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return response;
    },
    /** Runs the cron handler for one trigger. */
    scheduled: async (scheduledTime: number, cron: string) => {
      const ctx = createExecutionContext();
      await worker.scheduled(createScheduledController({ scheduledTime, cron }), testEnv, ctx);
      await waitOnExecutionContext(ctx);
    },
    /** Telegram API calls of one method, in order. */
    calls: (method: string) => telegram.filter((call) => call.method === method),
    /** Buttons of the most recent call that carried an inline keyboard. */
    lastButtons: () => buttons([...telegram].reverse().find((call) => call.payload.reply_markup)),
    lastText: () =>
      [...telegram]
        .reverse()
        .find((call) => call.method === "sendMessage" || call.method === "editMessageText")?.payload
        .text,
    reset: () => {
      telegram.length = 0;
      dispatches.length = 0;
      tme.length = 0;
      cryptoPay.length = 0;
      site.length = 0;
      files.length = 0;
      aiCalls.length = 0;
    },
    message: (
      from: From,
      text: string,
      chat?: Record<string, unknown>,
      extra?: Record<string, unknown>,
    ) => send(message(from, text, chat, extra)),
    /** A private message carrying a photo or a document instead of text. */
    media: (from: From, media: Record<string, unknown>) =>
      send({
        message: {
          message_id: updateId,
          date: 0,
          chat: { id: from.id, type: "private" },
          from,
          ...media,
        },
      }),
    /** Makes the next call to `method` answer with a Bot API error. */
    failOnce: (method: string, description: string) => forcedErrors.set(method, description),
    /** Like `message`, but resolves with the webhook response before background work finishes. */
    startMessage: (from: From, text: string) => start(message(from, text)),
    rejectTelegram: () => {
      telegramRejects = true;
    },
    /** Holds every t.me request until the returned function is called. */
    holdTme: () => {
      let release = () => {};
      tmeGate = new Promise((resolve) => {
        release = () => {
          tmeGate = null;
          resolve();
        };
      });
      return release;
    },
    callback: (
      from: From,
      data: string,
      message: Record<string, unknown> = {
        message_id: 1,
        date: 0,
        chat: { id: from.id, type: "private" },
        text: "…",
      },
    ) =>
      send({
        callback_query: {
          id: String(callbackId++),
          from,
          chat_instance: "1",
          data,
          message,
        },
      }),
    inline: (from: From, query: string) =>
      send({ inline_query: { id: String(callbackId++), from, query, offset: "" } }),
  };
}

function commandEntities(text: string) {
  const command = /^\/\w+(@\w+)?/.exec(text);
  return command
    ? { entities: [{ type: "bot_command", offset: 0, length: command[0].length }] }
    : {};
}

type Button = { text: string; callback_data?: string; url?: string };

/** Buttons of the inline keyboard attached to a Telegram API call. */
export function buttons(call: TelegramCall | undefined): Button[] {
  const markup = call?.payload.reply_markup;
  if (typeof markup !== "object" || markup === null || !("inline_keyboard" in markup)) return [];
  const rows = markup.inline_keyboard;
  return Array.isArray(rows) ? rows.flat() : [];
}
