import {
  closeFriendLinkRequest,
  type FriendLinkRequest,
  getPendingFriendLinkRequest,
  getUserLocale,
  insertFriendLinkRequest,
  upsertSetting,
} from "@tgbox/db";
import { type FriendLink, MAX_FRIEND_LINKS, SiteSettings } from "@tgbox/shared";
import { audit } from "./audit.ts";
import { markDirtyAndDispatch } from "./build.ts";
import { type Actor, background, type CoreContext } from "./context.ts";
import { getSettings } from "./settings.ts";

/** Hostname without a leading `www.`, so both spellings of a site count as one. */
function siteHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const sameSite = (a: string, b: string) => siteHost(a) !== null && siteHost(a) === siteHost(b);

/** Enough of a home page to find a footer link, without holding a huge page in memory. */
const MAX_PAGE_BYTES = 1_000_000;

/**
 * Whether the applicant's page mentions this site's host. One fetch per application, for the
 * reviewer's information only: a missing backlink is shown, never enforced.
 */
async function linksBack(ctx: CoreContext, url: string) {
  const host = ctx.config.SITE_URL ? siteHost(ctx.config.SITE_URL) : null;
  if (!host) return false;
  try {
    const res = await ctx.fetch(url, {
      headers: { "user-agent": `TGboxBot (+${ctx.config.SITE_URL}/links/)` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const page = (await res.text()).slice(0, MAX_PAGE_BYTES).toLowerCase();
    return page.includes(host);
  } catch {
    return false;
  }
}

export type FriendLinkApplication = {
  tgUserId: number;
  url: string;
  name: string;
  description: string;
};

/** Validated input from the bot. Refused when the site is already listed or the user waits. */
export async function applyForFriendLink(ctx: CoreContext, input: FriendLinkApplication) {
  const { site } = await getSettings(ctx);
  if (site.friendLinks.some((link) => sameSite(link.url, input.url))) {
    return { ok: false as const, error: "listed" as const };
  }
  if (await getPendingFriendLinkRequest(ctx.db, input.tgUserId)) {
    return { ok: false as const, error: "pending" as const };
  }
  const backlink = await linksBack(ctx, input.url);
  const request = await insertFriendLinkRequest(ctx.db, {
    ...input,
    backlink,
    createdAt: ctx.now(),
  });
  return { ok: true as const, request };
}

const notices = {
  approved: {
    zh: (name: string) => `🎉 你的友链申请「${name}」已通过，网站几分钟后更新。`,
    en: (name: string) =>
      `🎉 Your link application "${name}" was approved. The site updates in a few minutes.`,
  },
  rejected: {
    zh: (name: string) => `抱歉，你的友链申请「${name}」未通过。`,
    en: (name: string) => `Sorry, your link application "${name}" was not approved.`,
  },
};

/**
 * Tells the applicant the outcome, whichever of the bot or the admin decided it: in their chosen
 * bot language, else both. Best effort, after the response.
 */
async function notifyApplicant(
  ctx: CoreContext,
  request: FriendLinkRequest,
  outcome: keyof typeof notices,
) {
  const token = ctx.config.BOT_TOKEN;
  if (!token) return;
  await background(ctx, async () => {
    const locale = await getUserLocale(ctx.db, request.tgUserId);
    const notice = notices[outcome];
    const text = locale
      ? notice[locale](request.name)
      : `${notice.zh(request.name)}\n\n${notice.en(request.name)}`;
    await ctx.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: request.tgUserId, text }),
    });
  });
}

/** Writes the list into the `site` settings row and rebuilds the site when it changed. */
async function writeFriendLinks(ctx: CoreContext, friendLinks: FriendLink[]) {
  const { site } = await getSettings(ctx);
  const value = SiteSettings.parse({ ...site, friendLinks });
  const { rowsWritten } = await upsertSetting(ctx.db, "site", JSON.stringify(value), ctx.now());
  if (rowsWritten > 0) await markDirtyAndDispatch(ctx);
  return rowsWritten > 0;
}

/**
 * Approves a pending application and appends it to the list, both descriptions set to the
 * applicant's text (the admin can translate it later), and tells the applicant. Null when it was
 * already handled; "full" leaves it pending.
 */
export async function approveFriendLink(ctx: CoreContext, input: { id: number; actor: Actor }) {
  const { site } = await getSettings(ctx);
  if (site.friendLinks.length >= MAX_FRIEND_LINKS)
    return { ok: false as const, error: "full" as const };
  const request = await closeFriendLinkRequest(ctx.db, input.id, "approved", ctx.now());
  if (!request) return null;
  const link: FriendLink = {
    name: request.name,
    url: request.url,
    descZh: request.description,
    descEn: request.description,
  };
  if (!site.friendLinks.some((existing) => sameSite(existing.url, link.url))) {
    await writeFriendLinks(ctx, [...site.friendLinks, link]);
  }
  await audit(ctx, input.actor, "friendLink.approve", `friend-link:${request.id}`, link);
  await notifyApplicant(ctx, request, "approved");
  return { ok: true as const, request };
}

/** Tells the applicant; null when it was already handled. */
export async function rejectFriendLink(ctx: CoreContext, input: { id: number; actor: Actor }) {
  const request = await closeFriendLinkRequest(ctx.db, input.id, "rejected", ctx.now());
  if (!request) return null;
  await audit(ctx, input.actor, "friendLink.reject", `friend-link:${request.id}`, {
    url: request.url,
  });
  await notifyApplicant(ctx, request, "rejected");
  return request;
}

/** The admin's edit of the whole list (text, order, removals). */
export async function setFriendLinks(
  ctx: CoreContext,
  input: { links: FriendLink[]; actor: Actor },
) {
  const changed = await writeFriendLinks(ctx, input.links);
  if (changed) await audit(ctx, input.actor, "friendLink.update", "settings:site", input.links);
  return { changed };
}
