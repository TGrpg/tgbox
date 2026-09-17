import {
  addBlacklist,
  removeBlacklist,
  setEntriesStatus,
  setEntryCategoryAndTags,
  tgActor,
} from "@tgbox/core";
import {
  type BlacklistType,
  getEntriesByIdRange,
  getEntryByUsername,
  getEntryTagIds,
  listCategories,
  listTags,
} from "@tgbox/db";
import { type EntryStatus, MAX_TAGS, parseTelegramRef } from "@tgbox/shared";
import { Composer, type Context } from "grammy";
import type { App } from "./app.ts";
import { i18n } from "./i18n/index.ts";

/** `/ban 12345` → user id, `/ban @name` or a t.me link → username. */
function parseBlacklistTarget(arg: string): { type: BlacklistType; value: string } | null {
  if (/^\d+$/.test(arg)) return { type: "user", value: arg };
  const username = parseTelegramRef(arg);
  return username ? { type: "username", value: username.toLowerCase() } : null;
}

const actorOf = (ctx: Context) => tgActor(ctx.from?.id ?? 0);

const args = (ctx: Context) => {
  const match = typeof ctx.match === "string" ? ctx.match : "";
  return match.trim().split(/\s+/).filter(Boolean);
};

export function admin(app: App) {
  const composer = new Composer<Context>();
  // Non-admins get no reaction: the commands stay invisible in shared chats.
  const commands = composer.filter((ctx) => app.isAdmin(ctx));

  commands.command(["ban", "unban"], async (ctx) => {
    const m = i18n(ctx).admin;
    const [first = "", ...rest] = args(ctx);
    const target = parseBlacklistTarget(first);
    if (!target) {
      await ctx.reply(ctx.message?.text.startsWith("/ban") ? m.banUsage : m.unbanUsage);
      return;
    }
    const label = target.type === "user" ? target.value : `@${target.value}`;
    if (ctx.message?.text.startsWith("/ban")) {
      const reason = rest.join(" ") || null;
      await addBlacklist(app.core, { ...target, reason, actor: actorOf(ctx) });
      await ctx.reply(m.banned(label));
    } else {
      const removed = await removeBlacklist(app.core, { ...target, actor: actorOf(ctx) });
      await ctx.reply(removed ? m.unbanned(label) : m.notBanned(label));
    }
  });

  async function entryFromArgs(ctx: Context, usage: string) {
    const [first = ""] = args(ctx);
    const username = parseTelegramRef(first);
    const m = i18n(ctx).admin;
    if (!username) {
      await ctx.reply(usage);
      return undefined;
    }
    const entry = await getEntryByUsername(app.db, username);
    if (!entry) await ctx.reply(m.entryNotFound(username));
    return entry;
  }

  const statusCommands: Record<string, EntryStatus> = {
    hide: "hidden_by_admin",
    unhide: "approved",
    remove: "removed",
  };
  commands.command(Object.keys(statusCommands), async (ctx) => {
    const m = i18n(ctx).admin;
    const name = ctx.message?.text.slice(1).split(/[\s@]/)[0] ?? "";
    const status = statusCommands[name];
    if (!status) return;
    const entry = await entryFromArgs(ctx, m.entryUsage(name));
    if (!entry) return;
    const { changed: ids } = await setEntriesStatus(app.core, {
      ids: [entry.id],
      status,
      actor: actorOf(ctx),
    });
    const changed = ids.length > 0;
    await ctx.reply(m.statusSet(entry.username, status, changed));
  });

  commands.command("setcat", async (ctx) => {
    const m = i18n(ctx).admin;
    const entry = await entryFromArgs(ctx, m.setcatUsage);
    if (!entry) return;
    const slug = args(ctx)[1] ?? "";
    const category = (await listCategories(app.db)).find(
      (row) => row.kind === entry.kind && row.slug === slug,
    );
    if (!category) {
      await ctx.reply(m.unknownCategory(slug, entry.kind));
      return;
    }
    const { categoryChanged } = await setEntryCategoryAndTags(app.core, {
      id: entry.id,
      categoryId: category.id,
      actor: actorOf(ctx),
    });
    await ctx.reply(m.categorySet(entry.username, category.slug, categoryChanged));
  });

  commands.command("settags", async (ctx) => {
    const m = i18n(ctx).admin;
    const entry = await entryFromArgs(ctx, m.settagsUsage);
    if (!entry) return;
    const slugs = [
      ...new Set(
        args(ctx)
          .slice(1)
          .join(",")
          .split(",")
          .map((slug) => slug.trim())
          .filter(Boolean),
      ),
    ];
    const all = await listTags(app.db);
    const unknown = slugs.filter((slug) => !all.some((tag) => tag.slug === slug));
    if (unknown.length || slugs.length > MAX_TAGS) {
      await ctx.reply(unknown.length ? m.unknownTags(unknown) : m.tooManyTags(MAX_TAGS));
      return;
    }
    const tagIds = all.filter((tag) => slugs.includes(tag.slug)).map((tag) => tag.id);
    const { tagsChanged } = await setEntryCategoryAndTags(app.core, {
      id: entry.id,
      tagIds,
      actor: actorOf(ctx),
    });
    await ctx.reply(m.tagsSet(entry.username, slugs, tagsChanged));
  });

  commands.command("status", async (ctx) => {
    const m = i18n(ctx).admin;
    const entry = await entryFromArgs(ctx, m.entryUsage("status"));
    if (!entry) return;
    const [row] = await getEntriesByIdRange(app.db, entry.id, entry.id);
    const [categories, allTags, tagIds] = await Promise.all([
      listCategories(app.db),
      listTags(app.db),
      getEntryTagIds(app.db, entry.id),
    ]);
    await ctx.reply(
      m.status({
        entry,
        members: row?.stats?.members ?? null,
        category: categories.find((category) => category.id === entry.categoryId)?.slug ?? "?",
        tags: allTags.filter((tag) => tagIds.includes(tag.id)).map((tag) => tag.slug),
      }),
    );
  });

  return composer;
}
