import { env } from "cloudflare:workers";
import { type CoreContext, emailActor } from "@tgbox/core";
import { createDb, syncTaxonomy } from "@tgbox/db";
import firstPostHtml from "../../telegram/fixtures/channel-first-post.html?raw";
import postsHtml from "../../telegram/fixtures/channel-posts.html?raw";
import bannedHtml from "../../telegram/fixtures/profile-banned.html?raw";
import botHtml from "../../telegram/fixtures/profile-bot.html?raw";
import channelHtml from "../../telegram/fixtures/profile-channel.html?raw";
import groupHtml from "../../telegram/fixtures/profile-group.html?raw";
import notFoundHtml from "../../telegram/fixtures/profile-not-found.html?raw";
import userHtml from "../../telegram/fixtures/profile-user.html?raw";

export const db = createDb(env.DB);
export const NOW = Date.UTC(2026, 8, 17);
export const actor = emailActor("Admin@Example.com");

const profiles: Record<string, string> = {
  some_group: groupHtml,
  some_bot: botHtml,
  some_user: userHtml,
  gone_away: notFoundHtml,
  banned_one: bannedHtml,
};

/** Empty mutable tables, synced taxonomy, and a context whose fetch fakes t.me and GitHub. */
export async function setup(config: Partial<CoreContext["config"]> = {}) {
  await env.DB.batch(
    [
      "submissions",
      "blacklist",
      "entries",
      "entry_stats",
      "entry_tags",
      "entries_fts",
      "site_state",
      "audit_log",
      "settings",
      "credentials",
      "orders",
      "promotions",
      "hidden_posts",
      "usdt_payments",
      "bot_users",
      "broadcasts",
      "friend_link_requests",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  await syncTaxonomy(db);
  const dispatches: string[] = [];
  // Tests can make GitHub refuse a dispatch (revoked token, repo renamed…).
  const github = { status: 204, body: "" };
  const tme: string[] = [];
  const telegram: { method: string; body: unknown }[] = [];
  // Per-recipient Bot API error replies (`chat_id` → body), e.g. a 403 from a user who blocked us.
  const telegramErrors = new Map<number, unknown>();
  // Per-method `result` of a successful call (profile photos, file paths, uploaded messages…).
  const telegramResults = new Map<string, unknown>();
  // Bodies of Telegram file downloads (`/file/bot<token>/<path>`).
  const telegramFiles: string[] = [];
  // Tests drive the chain: which transfers the address has received, and how TronGrid misbehaves.
  const tron = {
    transfers: [] as {
      transaction_id: string;
      block_timestamp: number;
      value: string;
      token_info?: { address: string };
    }[],
    status: 200,
    throws: false,
    calls: [] as string[],
  };
  // Outside websites (`*.example`), e.g. a friend-link applicant's home page.
  const websites = new Map<string, string>();
  const ctx: CoreContext = {
    db,
    now: () => NOW,
    config: { GITHUB_REPO: "owner/tgbox", GITHUB_DISPATCH_TOKEN: "token", ...config },
    fetch: async (input, init) => {
      const url = new URL(input);
      if (url.hostname === "api.github.com") {
        dispatches.push(url.pathname);
        return new Response(github.body || null, { status: github.status });
      }
      if (url.hostname === "api.telegram.org") {
        if (url.pathname.includes("/file/bot")) {
          telegramFiles.push(url.pathname);
          return new Response(new Uint8Array([0xff, 0xd8, 0xff, 9]));
        }
        const method = url.pathname.split("/").at(-1) ?? "";
        // Uploads are multipart; everything else is JSON.
        const body =
          init?.body instanceof FormData
            ? Object.fromEntries(
                [...init.body.entries()].map(([key, value]) => [
                  key,
                  typeof value === "string" ? value : `<file ${value.size}B>`,
                ]),
              )
            : JSON.parse(String(init?.body ?? "null"));
        telegram.push({ method, body });
        const error = telegramErrors.get(Number(body?.chat_id));
        if (error) return Response.json(error);
        return Response.json({ ok: true, result: telegramResults.get(method) ?? true });
      }
      if (url.hostname === "t.me") {
        tme.push(url.pathname);
        const [first = "", , third] = url.pathname.split("/").filter(Boolean);
        if (first === "s") return new Response(third ? firstPostHtml : postsHtml);
        return new Response(profiles[first.toLowerCase()] ?? channelHtml);
      }
      if (url.hostname === "api.trongrid.io") {
        tron.calls.push(url.href);
        if (tron.status !== 200) return new Response("nope", { status: tron.status });
        if (tron.throws) throw new Error("network down");
        return Response.json({ data: tron.transfers });
      }
      if (url.hostname.endsWith(".example")) {
        const page = websites.get(url.hostname);
        return page === undefined ? new Response("gone", { status: 404 }) : new Response(page);
      }
      if (url.hostname.endsWith("telesco.pe")) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`unexpected fetch ${url.href}`);
    },
  };
  return {
    ctx,
    dispatches,
    github,
    tme,
    telegram,
    telegramErrors,
    telegramResults,
    telegramFiles,
    tron,
    websites,
  };
}

export async function auditRows() {
  const { results } = await env.DB.prepare(
    "SELECT actor, action, target FROM audit_log ORDER BY id",
  ).all();
  return results;
}
