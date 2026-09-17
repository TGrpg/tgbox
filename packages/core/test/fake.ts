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
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  await syncTaxonomy(db);
  const dispatches: string[] = [];
  const tme: string[] = [];
  const ctx: CoreContext = {
    db,
    now: () => NOW,
    config: { GITHUB_REPO: "owner/tgbox", GITHUB_DISPATCH_TOKEN: "token", ...config },
    fetch: async (input) => {
      const url = new URL(input);
      if (url.hostname === "api.github.com") {
        dispatches.push(url.pathname);
        return new Response(null, { status: 204 });
      }
      if (url.hostname === "t.me") {
        tme.push(url.pathname);
        const [first = "", , third] = url.pathname.split("/").filter(Boolean);
        if (first === "s") return new Response(third ? firstPostHtml : postsHtml);
        return new Response(profiles[first.toLowerCase()] ?? channelHtml);
      }
      if (url.hostname.endsWith("telesco.pe")) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`unexpected fetch ${url.href}`);
    },
  };
  return { ctx, dispatches, tme };
}

export async function auditRows() {
  const { results } = await env.DB.prepare(
    "SELECT actor, action, target FROM audit_log ORDER BY id",
  ).all();
  return results;
}
