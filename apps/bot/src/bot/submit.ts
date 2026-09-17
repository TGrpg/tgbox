import {
  countSubmissionsSince,
  createSubmission,
  deleteBotDraft,
  findPendingSubmission,
  getBlacklistEntry,
  getBotDraft,
  getEntryByUsername,
  listCategories,
  listTags,
  putBotDraft,
  setSubmissionAdminMessage,
} from "@tgbox/db";
import { type EntryKind, entryKinds, type Locale, MAX_TAGS, parseTelegramRef } from "@tgbox/shared";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { messages } from "./i18n/index.ts";
import { reviewKeyboard } from "./review.ts";
import { relayEnabled } from "./support.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
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
  /** indexes into the D1 tag list (ordered by id), encoded as a bitmask */
  tagMask: number;
};

// Drafts come back from D1 as JSON: validate instead of trusting the shape.
function parseDraft(step: string, payload: unknown): { step: Step; draft: Draft } | null {
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
    typeof p.tagMask !== "number"
  ) {
    return null;
  }
  return {
    step,
    draft: {
      username: p.username,
      kind,
      title: p.title,
      description: p.description,
      members: p.members,
      categoryId: p.categoryId,
      tagMask: p.tagMask,
    },
  };
}

const version = (updatedAt: number) => updatedAt.toString(36);

// Tags live in D1 and admins may add more, so the mask uses arithmetic instead of 32-bit bitwise
// operators (safe up to 53 tags; the callback data stays well under Telegram's 64 bytes).
const hasBit = (mask: number, index: number) => Math.floor(mask / 2 ** index) % 2 === 1;
const selectedTagIndexes = (mask: number, count: number) =>
  Array.from({ length: count }, (_tag, index) => index).filter((index) => hasBit(mask, index));
const validMask = (mask: number, count: number) =>
  Number.isSafeInteger(mask) &&
  mask >= 0 &&
  mask < 2 ** count &&
  selectedTagIndexes(mask, count).length <= MAX_TAGS;

type TagRow = { slug: string; nameZh: string; nameEn: string };
const tagName = (locale: Locale, tag: TagRow | undefined) =>
  tag ? (locale === "en" ? tag.nameEn : tag.nameZh) : "";

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

  async function categoryView(locale: Locale, draft: Draft, v: string) {
    const keyboard = new InlineKeyboard();
    const rows = await categoriesFor(draft.kind);
    rows.forEach((category, index) => {
      keyboard.text(locale === "en" ? category.nameEn : category.nameZh, `sc:${v}:${category.id}`);
      if (index % 2 === 1) keyboard.row();
    });
    keyboard.row().text(messages(locale).cancel, `sx:${v}:`);
    return { text: messages(locale).chooseCategory, keyboard };
  }

  async function tagView(locale: Locale, mask: number, page: number, v: string) {
    const m = messages(locale);
    const tags = await allTags();
    const count = selectedTagIndexes(mask, tags.length).length;
    const keyboard = new InlineKeyboard();
    const start = page * TAGS_PER_PAGE;
    tags.slice(start, start + TAGS_PER_PAGE).forEach((tag, offset) => {
      const index = start + offset;
      const selected = hasBit(mask, index);
      // A full selection only allows deselecting; the unchanged mask makes the tap a no-op.
      const bit = 2 ** index;
      const next = selected ? mask - bit : count < MAX_TAGS ? mask + bit : mask;
      keyboard.text(
        `${selected ? "✅ " : ""}${tagName(locale, tag)}`,
        `st:${v}:${next.toString(36)}.${page}`,
      );
      if (offset % 2 === 1) keyboard.row();
    });
    keyboard.row();
    const pages = Math.ceil(tags.length / TAGS_PER_PAGE);
    if (page > 0) keyboard.text(m.prevPage, `st:${v}:${mask.toString(36)}.${page - 1}`);
    if (page < pages - 1) keyboard.text(m.nextPage, `st:${v}:${mask.toString(36)}.${page + 1}`);
    keyboard
      .row()
      .text(m.tagsDone, `sd:${v}:${mask.toString(36)}`)
      .text(m.cancel, `sx:${v}:`);
    return { text: m.chooseTags(count, MAX_TAGS), keyboard };
  }

  async function confirmView(locale: Locale, draft: Draft, v: string) {
    const m = messages(locale);
    const category = (await categoriesFor(draft.kind)).find((row) => row.id === draft.categoryId);
    const tags = await allTags();
    const tagNames = selectedTagIndexes(draft.tagMask, tags.length).map((index) =>
      tagName(locale, tags[index]),
    );
    const text = [
      m.confirmTitle,
      "",
      profileText(locale, draft),
      `${m.category}: ${category ? (locale === "en" ? category.nameEn : category.nameZh) : m.none}`,
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

  /** Open submissions, then checks 2–4 of the submission order (blacklist runs in the guard); returns an error text. */
  async function precheck(locale: Locale, userId: number, username: string) {
    const m = messages(locale);
    const settings = (await app.settings()).bot;
    if (!settings.submissionsOpen) return m.submissionsClosed;
    if (await getEntryByUsername(app.db, username)) return m.alreadyListed(username);
    if (await findPendingSubmission(app.db, username)) return m.alreadyPending(username);
    const limit = settings.submitDailyLimit;
    if ((await countSubmissionsSince(app.db, userId, app.now() - DAY_MS)) >= limit) {
      return m.dailyLimit(limit);
    }
    return null;
  }

  composer.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return next();
    const locale = await app.locale(ctx);
    const m = messages(locale);
    const settings = (await app.settings()).bot;
    const username = parseTelegramRef(ctx.message.text);
    if (!username) {
      // With the support relay on, anything that isn't a link is a question for the support staff.
      if (relayEnabled(settings)) return next();
      await ctx.reply(m.invalidLink);
      return;
    }
    if (!settings.submissionsOpen) {
      await ctx.reply(m.submissionsClosed);
      return;
    }
    if (await getBlacklistEntry(app.db, "username", username)) return;
    const problem = await precheck(locale, ctx.from.id, username);
    if (problem) {
      await ctx.reply(problem);
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

      const draft: Draft = {
        username,
        kind,
        title: snap.profile.title ?? username,
        description: snap.profile.description ?? "",
        members: snap.profile.members ?? snap.profile.monthlyUsers,
        categoryId: null,
        tagMask: 0,
      };
      const v = await saveDraft(userId, "choosing_category", draft);
      const view = await categoryView(locale, draft, v);
      await answer(`${profileText(locale, draft)}\n\n${view.text}`, view.keyboard);
    });
  });

  composer.callbackQuery(/^(s[cdtoegx]):([0-9a-z]+):(.*)$/, async (ctx) => {
    const [, action = "", v = "", arg = ""] = ctx.match;
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
          : await tagView(locale, next.tagMask, 0, nv),
      );
      return;
    }

    if ((action === "st" || action === "sd") && step === "choosing_tags") {
      const [maskText = "", pageText = "0"] = arg.split(".");
      const mask = Number.parseInt(maskText, 36);
      const page = Number(pageText);
      const tagCount = (await allTags()).length;
      const pages = Math.ceil(tagCount / TAGS_PER_PAGE);
      if (!validMask(mask, tagCount) || !Number.isInteger(page) || page < 0 || page >= pages) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (action === "st") {
        // Toggling keeps the selection in the buttons only; the draft is written on "done".
        await ctx.answerCallbackQuery();
        await show(ctx, await tagView(locale, mask, page, v));
        return;
      }
      const next = { ...draft, tagMask: mask };
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
      await show(ctx, await tagView(locale, draft.tagMask, 0, nv));
      return;
    }

    if (action === "so" && step === "confirming" && draft.categoryId !== null) {
      const problem = await precheck(locale, userId, draft.username);
      if (problem) {
        await deleteBotDraft(app.db, userId);
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(problem);
        return;
      }
      const tags = await allTags();
      const selectedTags = selectedTagIndexes(draft.tagMask, tags.length).flatMap(
        (index) => tags[index] ?? [],
      );
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
      await ctx.editMessageText(m.submitted);
      return;
    }

    // Any action that doesn't belong to the draft's current step is a stale button.
    await ctx.answerCallbackQuery({ text: m.expired, show_alert: true });
  });

  return root;
}

function profileText(locale: Locale, draft: Draft) {
  const m = messages(locale);
  const lines = [m.profile(m.kinds[draft.kind], draft.title, draft.username)];
  if (draft.members !== null) lines.push(`${m.members}: ${draft.members.toLocaleString("en")}`);
  if (draft.description) lines.push(truncate(draft.description, 300));
  return lines.join("\n");
}

export function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
