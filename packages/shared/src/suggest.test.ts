import { describe, expect, test } from "vitest";
import { categories } from "./categories.ts";
import type { EntryKind } from "./domain.ts";
import { MAX_TAGS } from "./domain.ts";
import { type CategoryClassifier, type SuggestTaxonomy, suggestTaxonomy } from "./suggest.ts";
import { tags } from "./tags.ts";

/**
 * The seed taxonomy with ids, standing in for the D1 rows. Using the real categories and tags is
 * the point: a rule that names a slug nobody seeded would quietly never fire.
 */
const taxonomy: SuggestTaxonomy = {
  categories: categories.map((category, index) => ({ ...category, id: index + 1 })),
  tags: tags.map((tag, index) => ({ ...tag, id: index + 1 })),
};

const categoryId = (kind: EntryKind, slug: string) => {
  const found = taxonomy.categories.find((c) => c.kind === kind && c.slug === slug);
  if (!found) throw new Error(`no ${kind} category ${slug}`);
  return found.id;
};
const tagId = (slug: string) => {
  const found = taxonomy.tags.find((t) => t.slug === slug);
  if (!found) throw new Error(`no tag ${slug}`);
  return found.id;
};

/** Fails the test if it is ever called: the rules were supposed to be sure on their own. */
const neverCalled: CategoryClassifier = () => {
  throw new Error("the AI pass should not have run");
};

describe("the keyword pass", () => {
  test("places the giveaway index that had nowhere to go", async () => {
    const result = await suggestTaxonomy(
      {
        kind: "channel",
        title: "Telegram 抽奖",
        description: "抽奖导航，收录各种 Telegram 抽奖福利频道，每天更新。",
      },
      taxonomy,
      { classify: neverCalled },
    );

    expect(result).toMatchObject({
      categoryId: categoryId("channel", "giveaway"),
      source: "rules",
    });
    expect(result.tagIds).toContain(tagId("giveaway"));
    expect(result.tagIds).toContain(tagId("chinese"));
  });

  test.each([
    ["channel", "每日壁纸", "4K 高清壁纸每天更新", "wallpaper"],
    ["channel", "网盘资源分享", "夸克网盘、阿里云盘资源合集", "cloud-drive"],
    ["channel", "币圈快讯", "加密货币行情与空投信息", "crypto"],
    ["channel", "远程招聘", "远程工作、兼职招聘信息汇总", "jobs"],
    ["group", "VPS 交流群", "主机、独服、建站交流", "vps"],
    ["group", "同城交流", "本地华人留学生交流群", "local"],
    ["bot", "群管助手", "反垃圾、验证、封禁，一站式群组管理", "group-admin"],
    ["bot", "视频下载机器人", "解析并下载 YouTube、TikTok 视频", "media"],
  ] satisfies [EntryKind, string, string, string][])(
    "%s %j → %s",
    async (kind, title, description, slug) => {
      const result = await suggestTaxonomy({ kind, title, description }, taxonomy, {
        classify: neverCalled,
      });
      expect(result).toMatchObject({ categoryId: categoryId(kind, slug), source: "rules" });
    },
  );

  test("says nothing rather than guessing from a description with no keywords", async () => {
    const result = await suggestTaxonomy(
      { kind: "channel", title: "Zephyr", description: "偶尔更新一些东西。" },
      taxonomy,
    );
    expect(result).toMatchObject({ categoryId: null, source: "none" });
  });

  test("suggests at most MAX_TAGS tags", async () => {
    const result = await suggestTaxonomy(
      {
        kind: "channel",
        title: "电影 剧集 动漫 音乐 电子书 教程 设计 摄影 体育 招聘",
        description: "电影 剧集 动漫 音乐 电子书 教程 设计 摄影 体育 招聘",
      },
      taxonomy,
    );
    expect(result.tagIds.length).toBeLessThanOrEqual(MAX_TAGS);
  });

  test("an empty profile gets no suggestion at all", async () => {
    const result = await suggestTaxonomy(
      { kind: "channel", title: " ", description: "" },
      taxonomy,
    );
    expect(result).toEqual({ categoryId: null, tagIds: [], source: "none" });
  });
  test("a daily cadence is not the daily-news tag", async () => {
    // "每日" used to match this tag on its own, so 每日壁纸 came back pre-tagged as a news
    // briefing. Cadence is not format, and a suggestion the submitter has to undo is worse
    // than no suggestion at all.
    const wallpaper = await suggestTaxonomy(
      { kind: "channel", title: "每日壁纸", description: "高清手机壁纸分享，每天更新" },
      taxonomy,
      { classify: neverCalled },
    );
    expect(wallpaper.tagIds).not.toContain(tagId("daily-news"));

    // The words that actually name the format still match.
    const briefing = await suggestTaxonomy(
      { kind: "channel", title: "科技早报", description: "每天一份科技新闻早报" },
      taxonomy,
      { classify: neverCalled },
    );
    expect(briefing.tagIds).toContain(tagId("daily-news"));
  });
});

describe("the AI pass", () => {
  const unsure = { kind: "channel", title: "Zephyr", description: "偶尔更新一些东西。" } as const;

  test("runs only when the rules are unsure, and its answer is marked as AI", async () => {
    const asked: string[] = [];
    const classify: CategoryClassifier = async (request) => {
      asked.push(request.title);
      return "blog";
    };
    const result = await suggestTaxonomy(unsure, taxonomy, { classify });
    expect(asked).toEqual([unsure.title]);
    expect(result).toMatchObject({ categoryId: categoryId("channel", "blog"), source: "ai" });
  });

  test("is only offered categories of the entry's kind", async () => {
    let offered: readonly string[] = [];
    await suggestTaxonomy({ ...unsure, kind: "bot" }, taxonomy, {
      classify: async (request) => {
        offered = request.candidates.map((candidate) => candidate.slug);
        return null;
      },
    });
    const botSlugs = taxonomy.categories.filter((c) => c.kind === "bot").map((c) => c.slug);
    expect([...offered].sort()).toEqual([...botSlugs].sort());
  });

  test.each([
    ["nothing", null],
    ["a category of another kind", "group-admin"],
    ["a slug nobody seeded", "lottery"],
    ["prose instead of a slug", "I think this is a personal blog"],
  ])("falls back to no suggestion when the model answers %s", async (_case, answer) => {
    const result = await suggestTaxonomy(unsure, taxonomy, { classify: async () => answer });
    expect(result.categoryId).toBeNull();
    expect(result.source).toBe("none");
  });

  test("a failing classifier costs the suggestion, not the submission", async () => {
    const result = await suggestTaxonomy(unsure, taxonomy, {
      // `aiCategoryClassifier` swallows its own errors; this is the belt to that braces.
      classify: async () => null,
    });
    expect(result).toMatchObject({ categoryId: null, source: "none" });
  });
});

describe("staying inside the live taxonomy", () => {
  const samples = [
    { kind: "channel", title: "Telegram 抽奖", description: "抽奖导航" },
    { kind: "channel", title: "每日壁纸", description: "4K 高清壁纸" },
    { kind: "group", title: "VPS 交流", description: "主机 独服" },
    { kind: "bot", title: "下载机器人", description: "视频下载" },
  ] satisfies { kind: EntryKind; title: string; description: string }[];

  test.each(samples)("$kind $title", async (input) => {
    const result = await suggestTaxonomy(input, taxonomy, { classify: async () => "made-up-slug" });
    const allowed = taxonomy.categories
      .filter((category) => category.kind === input.kind)
      .map((category) => category.id);
    if (result.categoryId !== null) expect(allowed).toContain(result.categoryId);
    for (const id of result.tagIds) {
      expect(taxonomy.tags.map((tag) => tag.id)).toContain(id);
    }
  });

  test("a category the admin deleted is never suggested", async () => {
    const withoutGiveaway: SuggestTaxonomy = {
      categories: taxonomy.categories.filter((category) => category.slug !== "giveaway"),
      tags: taxonomy.tags,
    };
    const result = await suggestTaxonomy(
      { kind: "channel", title: "Telegram 抽奖", description: "抽奖导航" },
      withoutGiveaway,
    );
    expect(result.categoryId).not.toBe(categoryId("channel", "giveaway"));
    expect(result.source).not.toBe("rules");
  });
});
