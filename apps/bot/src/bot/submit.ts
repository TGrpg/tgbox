import { aiCategoryClassifier, checkSubmission } from "@tgbox/core";
import {
  createSubmission,
  deleteBotDraft,
  getBotDraft,
  listCategories,
  listTags,
  putBotDraft,
  setSubmissionAdminMessage,
} from "@tgbox/db";
import {
  type EntryKind,
  entryKinds,
  MAX_TAGS,
  parseTelegramRef,
  type SiteLocale,
  suggestTaxonomy,
  tagsForCategory,
} from "@tgbox/shared";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { localName, messages } from "./i18n/index.ts";
import { miniAppUrl } from "./menu-button.ts";
import { reviewKeyboard } from "./review.ts";
import { relayEnabled } from "./support.ts";

const TAGS_PER_PAGE = 10;

type Step = "choosing_category" | "choosing_tags" | "confirming";
const steps: readonly string[] = ["choosing_category", "choosing_tags", "confirming"];
const isStep = (step: string): step is Step => steps.includes(step);

type Draft = {
  username: string;
  kind: EntryKind;
  title: string;
  description: string;
  members: number | null;
  categoryId: number | null;
  /** What `suggestTaxonomy` proposed, so the keyboard can keep marking it after an edit. */
  suggestedCategoryId: number | null;
  /**
   * Tag ids, never positions in the tag list: an admin deleting a tag shifts every position after
   * it, which would silently change what a saved draft (or a button already on screen) means.
   */
  tagIds: number[];
};

/**
 * Tag ids go into callback data as four base36 digits at most, which keeps five of them, the
 * version and the page under Telegram's 64 bytes. D1 hands out small ids; nothing gets near this.
 */
const MAX_TAG_ID = 36 ** 4 - 1;

const isTagIds = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length <= MAX_TAGS &&
  value.every((id) => Number.isSafeInteger(id) && id > 0 && id <= MAX_TAG_ID);

/**
 * Drafts come back from D1 as JSON: validate instead of trusting the shape. A draft saved before
 * tags were stored by id carries `legacyTagMask` (bits over the id-ordered tag list), which the
 * caller converts once.
 */
function parseDraft(
  step: string,
  payload: unknown,
): { step: Step; draft: Draft; legacyTagMask?: number } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p: Record<string, unknown> = { ...payload };
  const kind = entryKinds.find((k) => k === p.kind);
  if (
    !isStep(step) ||
    !kind ||
    typeof p.username !== "string" ||
    typeof p.title !== "string" ||
    typeof p.description !== "string" ||
    !(p.members === null || typeof p.members === "number") ||
    !(p.categoryId === null || typeof p.categoryId === "number") ||
    // Absent in drafts written before suggestions existed; those just lose the ✨.
    !(p.suggestedCategoryId == null || typeof p.suggestedCategoryId === "number") ||
    !(isTagIds(p.tagIds) || typeof p.tagMask === "number")
  ) {
    return null;
  }
  return {
    step,
    ...(isTagIds(p.tagIds) || typeof p.tagMask !== "number" ? {} : { legacyTagMask: p.tagMask }),
    draft: {
      username: p.username,
      kind,
      title: p.title,
      description: p.description,
      members: p.members,
      categoryId: p.categoryId,
      suggestedCategoryId: typeof p.suggestedCategoryId === "number" ? p.suggestedCategoryId : null,
      tagIds: isTagIds(p.tagIds) ? p.tagIds : [],
    },
  };
}

const version = (updatedAt: number) => updatedAt.toString(36);

// A selection travels in callback data as base36 ids joined by "-": at most MAX_TAGS of them, each
// at most MAX_TAG_ID, so the data stays under Telegram's 64 bytes however many tags there are.
const encodeTagIds = (ids: number[]) => ids.map((id) => id.toString(36)).join("-");
/** Null for anything our buttons never send; ids of tags deleted since are the caller's to drop. */
function decodeTagIds(text: string) {
  const parts = text === "" ? [] : text.split("-");
  if (parts.length > MAX_TAGS || !parts.every((part) => /^[0-9a-z]{1,4}$/.test(part))) return null;
  const ids = parts.map((part) => Number.parseInt(part, 36));
  return new Set(ids).size === ids.length && ids.every((id) => id > 0) ? ids : null;
}

/** Tag ids of a pre-id draft's bitmask: bit `i` was the `i`-th tag of the id-ordered list. */
const idsOfLegacyMask = (mask: number, tags: { id: number }[]) =>
  tags
    .filter((_tag, index) => Math.floor(mask / 2 ** index) % 2 === 1)
    .map((tag) => tag.id)
    .slice(0, MAX_TAGS);

type TagRow = { slug: string; nameZh: string; nameEn: string };
const tagName = (locale: SiteLocale, tag: TagRow | undefined) =>
  tag ? localName(tag, locale) : "";

export function submit(app: App) {
  const root = new Composer<Context>();
  const composer = root.chatType("private");

  async function saveDraft(userId: number, step: Step, draft: Draft) {
    const updatedAt = app.now();
    await putBotDraft(app.db, { tgUserId: userId, step, payload: draft, updatedAt });
    return version(updatedAt);
  }

  // The bot is created per webhook request, so these memos cache taxonomy for one update only.
  let categoryRows: ReturnType<typeof listCategories> | undefined;
  let tagRows: ReturnType<typeof listTags> | undefined;
  const allTags = () => {
    tagRows ??= listTags(app.db);
    return tagRows;
  };

  async function categoriesFor(kind: EntryKind) {
    categoryRows ??= listCategories(app.db);
    return (await categoryRows).filter((category) => category.kind === kind);
  }

  async function categoryView(locale: SiteLocale, draft: Draft, v: string) {
    const keyboard = new InlineKeyboard();
    const rows = await categoriesFor(draft.kind);
    // The guess goes first with a ✨, everything else keeps its admin-defined order: the submitter
    // still sees the whole list, they just don't have to find the obvious answer in it.
    const suggested = rows.find((category) => category.id === draft.suggestedCategoryId);
    const ordered = suggested ? [suggested, ...rows.filter((row) => row !== suggested)] : rows;
    ordered.forEach((category, index) => {
      const name = localName(category, locale);
      keyboard.text(category === suggested ? `✨ ${name}` : name, `sc:${v}:${category.id}`);
      if (index % 2 === 1) keyboard.row();
    });
    keyboard.row().text(messages(locale).cancel, `sx:${v}:`);
    const m = messages(locale);
    return { text: suggested ? m.chooseCategorySuggested : m.chooseCategory, keyboard };
  }

  /** At least one page, so "done" still works when the admin has no tags at all. */
  const tagPages = (count: number) => Math.max(1, Math.ceil(count / TAGS_PER_PAGE));

  /**
   * The category's hinted tags first, then the rest; `picked` is a list of tag ids. A picked tag
   * deleted since drops out here, so it neither takes a slot nor rides along in the buttons.
   */
  async function tagView(
    locale: SiteLocale,
    draft: Draft,
    picked: number[],
    page: number,
    v: string,
  ) {
    const m = messages(locale);
    const tags = await allTags();
    const selected = picked.filter((id) => tags.some((tag) => tag.id === id));
    const category = (await categoriesFor(draft.kind)).find((row) => row.id === draft.categoryId);
    const { hinted, rest } = tagsForCategory(draft.kind, category?.slug ?? null, tags);
    const shown = [...hinted, ...rest];
    const keyboard = new InlineKeyboard();
    const start = page * TAGS_PER_PAGE;
    shown.slice(start, start + TAGS_PER_PAGE).forEach((tag, offset) => {
      const on = selected.includes(tag.id);
      // A full selection only allows deselecting; the unchanged list makes the tap a no-op.
      const next = on
        ? selected.filter((id) => id !== tag.id)
        : selected.length < MAX_TAGS
          ? [...selected, tag.id]
          : selected;
      keyboard.text(
        `${on ? "✅ " : ""}${tagName(locale, tag)}`,
        `st:${v}:${encodeTagIds(next)}.${page}`,
      );
      if (offset % 2 === 1) keyboard.row();
    });
    keyboard.row();
    const ids = encodeTagIds(selected);
    if (page > 0) keyboard.text(m.prevPage, `st:${v}:${ids}.${page - 1}`);
    if (page < tagPages(shown.length) - 1) keyboard.text(m.nextPage, `st:${v}:${ids}.${page + 1}`);
    keyboard.row().text(m.tagsDone, `sd:${v}:${ids}`).text(m.cancel, `sx:${v}:`);
    return { text: m.chooseTags(selected.length, MAX_TAGS), keyboard };
  }

  async function confirmView(locale: SiteLocale, draft: Draft, v: string) {
    const m = messages(locale);
    const category = (await categoriesFor(draft.kind)).find((row) => row.id === draft.categoryId);
    // A tag deleted since it was picked simply drops out, here and from the submission alike.
    const tagNames = (await allTags())
      .filter((tag) => draft.tagIds.includes(tag.id))
      .map((tag) => tagName(locale, tag));
    const text = [
      m.confirmTitle,
      "",
      profileText(locale, draft),
      `${m.category}: ${category ? localName(category, locale) : m.none}`,
      `${m.tags}: ${tagNames.length ? tagNames.join(", ") : m.none}`,
    ].join("\n");
    const keyboard = new InlineKeyboard()
      .text(m.confirm, `so:${v}:`)
      .row()
      .text(m.editCategory, `se:${v}:`)
      .text(m.editTags, `sg:${v}:`)
      .row()
      .text(m.cancel, `sx:${v}:`);
    return { text, keyboard };
  }

  async function show(
    ctx: Context,
    view: { text: string; keyboard: InlineKeyboard },
  ): Promise<void> {
    try {
      await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    } catch (error) {
      // Re-rendering an identical keyboard (e.g. tapping a tag when 5 are selected) is not an error.
      if (!String(error).includes("message is not modified")) throw error;
    }
  }

  /**
   * The submission rules, shared with the Mini App (`checkSubmission`), as bot copy: null means
   * go ahead, an empty string means say nothing at all (blacklisted username, like the guard).
   */
  async function precheck(locale: SiteLocale, userId: number, username: string) {
    const m = messages(locale);
    const result = await checkSubmission(app.core, { tgUserId: userId, username });
    if (result.ok) return null;
    switch (result.error) {
      case "closed":
        return m.submissionsClosed;
      case "invalid":
        return m.invalidLink;
      case "banned":
        return "";
      case "already_listed":
        return m.alreadyListed(username);
      case "already_pending":
        return m.alreadyPending(username);
      case "daily_limit":
        return m.dailyLimit((await app.settings()).bot.submitDailyLimit);
    }
  }

  composer.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return next();
    const locale = await app.locale(ctx);
    const m = messages(locale);
    const settings = (await app.settings()).bot;
    const username = parseTelegramRef(ctx.message.text);
    if (!username) {
      // With the support relay on, anything that isn't a link is a question for the support staff.
      if (relayEnabled(settings)) {
        // …but a link that didn't parse (invite link, typo) would vanish into the relay with no sign
        // that the submission never happened. Say why it was refused, then relay it anyway.
        if (looksLikeSubmission(ctx.message.text)) await ctx.reply(m.invalidLink);
        return next();
      }
      await ctx.reply(m.invalidLink);
      return;
    }
    const problem = await precheck(locale, ctx.from.id, username);
    if (problem !== null) {
      if (problem) await ctx.reply(problem);
      return;
    }

    // Fetching t.me can take several seconds; Telegram retries webhooks that answer slowly, so
    // acknowledge now and finish the lookup after the response.
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const checking = await ctx.reply(m.checking(username)).catch(() => null);
    const answer = async (text: string, keyboard?: InlineKeyboard) => {
      const other = keyboard ? { reply_markup: keyboard } : {};
      if (checking) await ctx.api.editMessageText(chatId, checking.message_id, text, other);
      else await ctx.api.sendMessage(chatId, text, other);
    };

    await app.background(async () => {
      const snap = await app.snapshot(username, { knownKind: null, needCreatedAt: false });
      if (snap.kind === "user") return answer(m.userAccount(username));
      if (snap.liveness === "not_found") return answer(m.notFound(username));
      if (snap.liveness === "banned") return answer(m.banned(username));
      const kind = entryKinds.find((k) => k === snap.kind);
      if (snap.liveness !== "active" || !kind || !snap.profile) return answer(m.unavailable);

      const title = snap.profile.title ?? username;
      const description = snap.profile.description ?? "";
      // Runs after the webhook was acknowledged, so an unsure guess may spend one AI call without
      // anyone waiting on it. A failure here costs the ✨ mark, never the submission.
      const suggestion = await suggestTaxonomy(
        { kind, title, description },
        { categories: await categoriesFor(kind), tags: await allTags() },
        { classify: app.env.AI ? aiCategoryClassifier(app.env.AI) : undefined },
      );
      const draft: Draft = {
        username,
        kind,
        title,
        description,
        members: snap.profile.members ?? snap.profile.monthlyUsers,
        categoryId: null,
        suggestedCategoryId: suggestion.categoryId,
        tagIds: [],
      };
      const v = await saveDraft(userId, "choosing_category", draft);
      const view = await categoryView(locale, draft, v);
      await answer(`${profileText(locale, draft)}\n\n${view.text}`, view.keyboard);
    });
  });

  composer.callbackQuery(/^(s[cdtoegx]):([0-9a-z]+):(.*)$/, async (ctx) => {
    const [, action = "", sentVersion = "", sentArg = ""] = ctx.match;
    let v = sentVersion;
    let arg = sentArg;
    const locale = await app.locale(ctx);
    const m = messages(locale);
    const userId = ctx.from.id;
    const row = await getBotDraft(app.db, userId, app.now());
    const current = row && version(row.updatedAt) === v ? parseDraft(row.step, row.payload) : null;
    if (!current) {
      await ctx.answerCallbackQuery({ text: m.expired, show_alert: true });
      await ctx.editMessageReplyMarkup().catch(() => {});
      return;
    }
    const { step, draft } = current;
    if (current.legacyTagMask !== undefined && action !== "sx") {
      // Saved before tags were stored by id, so its buttons still send bitmasks over the id-ordered
      // tag list. Both are read against today's list — a tag deleted since shifts the bits, and
      // nothing recorded the old list — and the draft is saved converted, so those buttons expire.
      const tags = await allTags();
      draft.tagIds = idsOfLegacyMask(current.legacyTagMask, tags);
      if (action === "st" || action === "sd") {
        const [maskText = "", page = "0"] = arg.split(".");
        const mask = Number.parseInt(maskText, 36);
        if (!/^[0-9a-z]+$/.test(maskText) || !Number.isSafeInteger(mask)) {
          await ctx.answerCallbackQuery();
          return;
        }
        arg = `${encodeTagIds(idsOfLegacyMask(mask, tags))}.${page}`;
      }
      v = await saveDraft(userId, step, draft);
    }

    if (action === "sx") {
      await deleteBotDraft(app.db, userId);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(m.cancelled);
      return;
    }

    if (action === "sc" && step === "choosing_category") {
      const categoryId = Number(arg);
      if (!(await categoriesFor(draft.kind)).some((category) => category.id === categoryId)) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = { ...draft, categoryId };
      // Editing an existing submission's category goes straight back to the summary.
      const nextStep = draft.categoryId === null ? "choosing_tags" : "confirming";
      const nv = await saveDraft(userId, nextStep, next);
      await ctx.answerCallbackQuery();
      await show(
        ctx,
        nextStep === "confirming"
          ? await confirmView(locale, next, nv)
          : await tagView(locale, next, next.tagIds, 0, nv),
      );
      return;
    }

    if ((action === "st" || action === "sd") && step === "choosing_tags") {
      const [idsText = "", pageText = "0"] = arg.split(".");
      const tags = await allTags();
      const decoded = decodeTagIds(idsText);
      const page = Number(pageText);
      if (!decoded || !Number.isInteger(page) || page < 0 || page >= tagPages(tags.length)) {
        await ctx.answerCallbackQuery();
        return;
      }
      // A tag deleted while the picker was open drops out instead of making every button invalid.
      const selected = decoded.filter((id) => tags.some((tag) => tag.id === id));
      if (action === "st") {
        // Toggling keeps the selection in the buttons only; the draft is written on "done".
        await ctx.answerCallbackQuery();
        await show(ctx, await tagView(locale, draft, selected, page, v));
        return;
      }
      const next = { ...draft, tagIds: selected };
      const nv = await saveDraft(userId, "confirming", next);
      await ctx.answerCallbackQuery();
      await show(ctx, await confirmView(locale, next, nv));
      return;
    }

    if (action === "se" && step === "confirming") {
      const nv = await saveDraft(userId, "choosing_category", draft);
      await ctx.answerCallbackQuery();
      await show(ctx, await categoryView(locale, draft, nv));
      return;
    }

    if (action === "sg" && step === "confirming") {
      const nv = await saveDraft(userId, "choosing_tags", draft);
      await ctx.answerCallbackQuery();
      await show(ctx, await tagView(locale, draft, draft.tagIds, 0, nv));
      return;
    }

    if (action === "so" && step === "confirming" && draft.categoryId !== null) {
      const problem = await precheck(locale, userId, draft.username);
      if (problem !== null) {
        await deleteBotDraft(app.db, userId);
        await ctx.answerCallbackQuery();
        if (problem) await ctx.editMessageText(problem);
        return;
      }
      const selectedTags = (await allTags()).filter((tag) => draft.tagIds.includes(tag.id));
      const submissionId = await createSubmission(app.db, {
        tgUserId: userId,
        username: draft.username,
        kind: draft.kind,
        categoryId: draft.categoryId,
        tagIds: selectedTags.map((tag) => tag.id),
        fetchedTitle: draft.title,
        fetchedDescription: draft.description,
        fetchedMembers: draft.members,
        createdAt: app.now(),
      });
      await deleteBotDraft(app.db, userId);
      if (submissionId === null) {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(m.alreadyPending(draft.username));
        return;
      }

      // Queue the admin notice before touching the user's message: if answering or editing fails
      // (query too old, message gone), the pending submission must still reach the reviewers.
      const categoryName = (await categoriesFor(draft.kind)).find(
        (category) => category.id === draft.categoryId,
      )?.nameZh;
      const text = messages("zh").admin.newSubmission({
        ...draft,
        category: categoryName ?? "",
        tags: selectedTags.map((tag) => tag.nameZh),
        submitter: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
        submitterUsername: ctx.from.username ?? null,
        submitterId: userId,
      });
      await app.background(async () => {
        const { mode, sent } = await app.sendReview(text, {
          link_preview_options: { is_disabled: true },
          reply_markup: reviewKeyboard(submissionId),
        });
        // Private copies have one message per admin, so only the review chat message is recorded.
        const [message] = sent;
        if (mode === "chat" && message) {
          await setSubmissionAdminMessage(app.db, submissionId, message.message_id);
        }
      });
      await ctx.answerCallbackQuery();
      // Until now this message was a dead end: the bot has no way to show a submission's status.
      const appUrl = miniAppUrl(app.env.SITE_URL, locale);
      await ctx.editMessageText(m.submitted, {
        reply_markup: appUrl
          ? new InlineKeyboard().webApp(messages(locale).openAppMy, `${appUrl}me/`)
          : undefined,
      });
      return;
    }

    // Any action that doesn't belong to the draft's current step is a stale button.
    await ctx.answerCallbackQuery({ text: m.expired, show_alert: true });
  });

  return root;
}

function profileText(locale: SiteLocale, draft: Draft) {
  const m = messages(locale);
  const lines = [m.profile(m.kinds[draft.kind], draft.title, draft.username)];
  if (draft.members !== null) lines.push(`${m.members}: ${draft.members.toLocaleString("en")}`);
  if (draft.description) lines.push(truncate(draft.description, 300));
  return lines.join("\n");
}

/** A private message that was probably meant as a submission rather than a question or an answer. */
export function looksLikeSubmission(text: string) {
  const value = text.trim();
  return value.startsWith("@") || /t\.me\//i.test(value);
}

export function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
