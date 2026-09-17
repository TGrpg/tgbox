import { entryKinds, locales } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { seoUi } from "../i18n/ui-seo.ts";
import {
  aboutSeo,
  categorySeo,
  descriptionBudget,
  detailSeo,
  type EntryFacts,
  entrySummary,
  formatExamples,
  homeSeo,
  keywords,
  kindSeo,
  localizedDescription,
  rankSeo,
  tagSeo,
  truncate,
} from "./seo.ts";

/** Google renders roughly 60 latin characters of a title; " | TGbox" is added on top. */
const TITLE_BUDGET = 60 - " | TGbox".length;

const facts: EntryFacts = {
  title: "每日科技",
  username: "techdaily",
  kindWord: "频道",
  categoryName: "科技",
  members: { count: "5,000", noun: "名订阅者" },
  created: "2025年8月2日",
  activity: "非常活跃",
  language: "中文",
};

describe("page titles", () => {
  const pages = locales.flatMap((locale) => [
    { locale, name: "home", seo: homeSeo(locale, { total: 28 }) },
    ...entryKinds.map((kind) => ({
      locale,
      name: `kind/${kind}`,
      seo: kindSeo(locale, kind, { count: 12, examples: [] }),
    })),
    {
      locale,
      name: "category",
      seo: categorySeo(locale, {
        kind: "channel",
        kindWord: locale === "zh" ? "频道" : "Channels",
        category: locale === "zh" ? "科技" : "Tech",
        count: 12,
        page: 1,
        examples: [],
      }),
    },
    { locale, name: "tag", seo: tagSeo(locale, { tag: "编程", count: 4, page: 1, examples: [] }) },
    { locale, name: "rank", seo: rankSeo(locale) },
    { locale, name: "about", seo: aboutSeo(locale) },
  ]);

  test.each(pages)("$locale $name fits the title budget", ({ seo }) => {
    expect(seo.title.length).toBeLessThanOrEqual(TITLE_BUDGET);
    expect(seo.title.trim()).toBe(seo.title);
  });

  // Injected entry names push a description past the budget; the base copy has to fit without them.
  test.each(pages)("$locale $name has a description and keywords", ({ locale, seo }) => {
    expect(seo.description.length).toBeGreaterThan(40);
    expect(seo.description.length).toBeLessThanOrEqual(descriptionBudget[locale]);
    expect(seo.keywords.split(", ").length).toBeGreaterThanOrEqual(4);
  });

  test("titles are unique within a locale", () => {
    for (const locale of locales) {
      const titles = pages.filter((page) => page.locale === locale).map((page) => page.seo.title);
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  test("Chinese titles carry the terms people actually search", () => {
    expect(homeSeo("zh", { total: 28 }).title).toContain("Telegram");
    expect(kindSeo("zh", "channel", { count: 1, examples: [] }).title).toContain("电报频道");
    expect(kindSeo("zh", "group", { count: 1, examples: [] }).title).toContain("电报群组");
    expect(kindSeo("zh", "bot", { count: 1, examples: [] }).title).toContain("电报机器人");
    // 排名, not 导航: Google Suggest has demand for the former and none for the latter.
    expect(rankSeo("zh").title).toContain("排名");
  });

  test("English titles name the kind and the list intent", () => {
    expect(kindSeo("en", "channel", { count: 1, examples: [] }).title).toMatch(
      /Telegram Channels List/,
    );
    expect(kindSeo("en", "group", { count: 1, examples: [] }).title).toMatch(/Telegram Groups/);
    expect(homeSeo("en", { total: 3 }).title).toMatch(/Telegram Channels, Groups & Bots/);
  });
});

describe("listing descriptions", () => {
  test("carry the live count and real entry names so no two read alike", () => {
    const seo = categorySeo("zh", {
      kind: "channel",
      kindWord: "频道",
      category: "科技",
      count: 12,
      page: 1,
      examples: ["每日科技", "Dev Notes", "AI 观察", "第四个不该出现"],
    });
    expect(seo.description).toContain("12");
    expect(seo.description).toContain("每日科技");
    expect(seo.description).toContain("AI 观察");
    expect(seo.description).not.toContain("第四个不该出现");
  });

  test("drop the examples clause entirely when there are no entries", () => {
    expect(formatExamples("zh", [])).toBe("");
    expect(formatExamples("en", ["", "  "])).toBe("");
    const seo = tagSeo("en", { tag: "programming", count: 0, page: 1, examples: [] });
    expect(seo.description).not.toContain("such as");
    expect(seo.description).not.toContain("{examples}");
  });

  test("paged listings get a distinct title", () => {
    const first = tagSeo("zh", { tag: "编程", count: 80, page: 1, examples: [] });
    const second = tagSeo("zh", { tag: "编程", count: 80, page: 2, examples: [] });
    expect(second.title).not.toBe(first.title);
    expect(second.title).toContain("第 2 页");
    expect(tagSeo("en", { tag: "coding", count: 80, page: 3, examples: [] }).title).toContain(
      "Page 3",
    );
  });
});

describe("entrySummary", () => {
  test("reads as one sentence with every known fact", () => {
    expect(entrySummary("zh", facts)).toBe(
      "每日科技（@techdaily）是 TGbox 收录的 Telegram 科技频道，目前有 5,000 名订阅者，创建于 2025年8月2日，活跃度为非常活跃，内容以中文为主。",
    );
  });

  test("drops the clauses whose facts are missing", () => {
    const summary = entrySummary("en", {
      title: "GPT Bot",
      username: "gptbot",
      kindWord: "bot",
      categoryName: "AI",
      members: null,
      created: null,
      activity: null,
      language: null,
    });
    expect(summary).toBe("GPT Bot (@gptbot) is a Telegram AI bot listed on TGbox.");
  });

  test("never leaves an unfilled placeholder behind", () => {
    for (const locale of locales) {
      expect(entrySummary(locale, { ...facts, members: null })).not.toMatch(/[{}]/);
    }
  });
});

describe("detailSeo", () => {
  test("titles with the name, handle and kind", () => {
    expect(detailSeo("zh", { facts, kind: "channel", description: "简介", tags: [] }).title).toBe(
      "每日科技（@techdaily）· Telegram 频道",
    );
    expect(
      detailSeo("en", {
        facts: { ...facts, kindWord: "channel" },
        kind: "channel",
        description: "About",
        tags: [],
      }).title,
    ).toBe("每日科技 (@techdaily) — Telegram channel");
  });

  test("describes the entry with the summary plus its own description, within budget", () => {
    const seo = detailSeo("zh", {
      facts,
      kind: "channel",
      description: "每天分享开发与科技新闻".repeat(20),
      tags: ["编程"],
    });
    expect(seo.description.startsWith("每日科技（@techdaily）")).toBe(true);
    expect(seo.description.length).toBeLessThanOrEqual(descriptionBudget.zh);
    expect(seo.description.endsWith("…")).toBe(true);
  });

  test("keywords lead with the entry, then its tags and the kind's terms", () => {
    const list = detailSeo("zh", {
      facts,
      kind: "channel",
      description: "",
      tags: ["编程", "中文"],
    }).keywords.split(", ");
    expect(list[0]).toBe("每日科技");
    expect(list).toContain("@techdaily");
    expect(list).toContain("科技频道");
    // English needs the space the Chinese template deliberately leaves out.
    expect(
      detailSeo("en", {
        facts: { ...facts, kindWord: "channel", categoryName: "Development" },
        kind: "channel",
        description: "",
        tags: [],
      }).keywords,
    ).toContain("Development channel");
    expect(list).toContain("编程");
    expect(list).toContain("电报频道大全");
  });
});

describe("localizedDescription", () => {
  const entry = {
    description: "每天分享开发与科技新闻",
    descriptionZh: "每天分享开发与科技新闻",
    descriptionEn: "Daily development and tech news.",
  };

  test("renders the locale's translation and flags it", () => {
    expect(localizedDescription(entry, "en")).toEqual({
      text: "Daily development and tech news.",
      translated: true,
    });
  });

  test("does not flag the locale that holds the original text", () => {
    expect(localizedDescription(entry, "zh")).toEqual({
      text: "每天分享开发与科技新闻",
      translated: false,
    });
  });

  test.each([
    { descriptionZh: null, descriptionEn: null },
    { descriptionZh: "   ", descriptionEn: "" },
    {},
  ])("falls back to the original when the translation is missing (%o)", (translations) => {
    for (const locale of locales) {
      expect(localizedDescription({ description: "原文", ...translations }, locale)).toEqual({
        text: "原文",
        translated: false,
      });
    }
  });
});

describe("helpers", () => {
  test("truncate collapses whitespace and only cuts past the limit", () => {
    expect(truncate("  a \n b  ", 10)).toBe("a b");
    expect(truncate("abcdefghij", 10)).toBe("abcdefghij");
    expect(truncate("abcdefghijk", 10)).toBe("abcdefghi…");
  });

  test("keywords dedupes while keeping the most specific term first", () => {
    expect(keywords(["电报频道", "Telegram"], ["Telegram", "电报", ""])).toBe(
      "电报频道, Telegram, 电报",
    );
  });

  test("every FAQ entry has a question and a substantial answer", () => {
    for (const locale of locales) {
      const { faq } = seoUi(locale);
      expect(faq.length).toBeGreaterThanOrEqual(3);
      for (const item of faq) {
        expect(item.question.length).toBeGreaterThan(5);
        expect(item.answer.length).toBeGreaterThan(40);
      }
    }
  });
});
