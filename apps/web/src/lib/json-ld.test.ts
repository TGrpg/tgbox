import { describe, expect, test } from "vitest";
import {
  breadcrumbJsonLd,
  entryJsonLd,
  faqJsonLd,
  itemListJsonLd,
  organizationId,
  organizationJsonLd,
  websiteJsonLd,
} from "./json-ld.ts";

const siteUrl = "https://tgbox.cc";

/** Every emitted object has to survive JSON.stringify → JSON.parse unchanged. */
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("organizationJsonLd", () => {
  const organization = organizationJsonLd({
    siteUrl,
    name: "TGbox",
    description: "A directory of Telegram channels.",
    logo: `${siteUrl}/icons/icon-180.png`,
    sameAs: ["https://github.com/TGrpg/tgbox", "https://t.me/tgboxccbot"],
  });

  test("is one stable entity other pages can reference", () => {
    expect(organization["@id"]).toBe(organizationId(siteUrl));
    expect(organization).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "TGbox",
      url: "https://tgbox.cc/",
    });
    expect(roundTrip(organization)).toEqual(organization);
  });

  test("claims the source repository so the two profiles resolve to the same entity", () => {
    expect(organization.sameAs).toContain("https://github.com/TGrpg/tgbox");
  });
});

describe("websiteJsonLd", () => {
  const website = websiteJsonLd({
    siteUrl,
    url: `${siteUrl}/en/`,
    name: "TGbox",
    description: "Telegram directory",
    inLanguage: "en",
    searchUrlTemplate: `${siteUrl}/en/?q={search_term_string}`,
  });

  test("names the site and credits the shared Organization", () => {
    expect(website).toMatchObject({
      "@type": "WebSite",
      "@id": "https://tgbox.cc/en/#website",
      url: "https://tgbox.cc/en/",
      inLanguage: "en",
      publisher: { "@id": organizationId(siteUrl) },
    });
  });

  test("declares the search entry point in the shape Schema.org specifies", () => {
    expect(website.potentialAction).toEqual({
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: "https://tgbox.cc/en/?q={search_term_string}" },
      "query-input": "required name=search_term_string",
    });
  });

  test("omits the action entirely when there is no search URL", () => {
    const bare = websiteJsonLd({
      siteUrl,
      url: `${siteUrl}/`,
      name: "TGbox",
      description: "d",
      inLanguage: "zh-CN",
    });
    expect("potentialAction" in bare).toBe(false);
  });
});

describe("breadcrumbJsonLd", () => {
  test("numbers positions from 1 and leaves the current page without a URL", () => {
    expect(
      breadcrumbJsonLd([
        { name: "首页", url: `${siteUrl}/` },
        { name: "频道", url: `${siteUrl}/channel/` },
        { name: "每日科技" },
      ]),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "首页", item: "https://tgbox.cc/" },
        { "@type": "ListItem", position: 2, name: "频道", item: "https://tgbox.cc/channel/" },
        { "@type": "ListItem", position: 3, name: "每日科技" },
      ],
    });
  });
});

describe("itemListJsonLd", () => {
  test("lists the rendered entries in order with a matching count", () => {
    const list = itemListJsonLd({
      name: "科技 · 频道",
      url: `${siteUrl}/channel/tech/`,
      items: [
        { name: "每日科技", url: `${siteUrl}/detail/techdaily/` },
        { name: "Dev Notes", url: `${siteUrl}/detail/devnotes/` },
      ],
    });
    expect(list).toMatchObject({ "@type": "ItemList", numberOfItems: 2 });
    expect(list.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "每日科技",
        url: "https://tgbox.cc/detail/techdaily/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Dev Notes",
        url: "https://tgbox.cc/detail/devnotes/",
      },
    ]);
  });

  test("stays valid when the listing is empty", () => {
    const list = itemListJsonLd({ name: "空", url: `${siteUrl}/tag/x/`, items: [] });
    expect(list.numberOfItems).toBe(0);
    expect(list.itemListElement).toEqual([]);
  });
});

describe("faqJsonLd", () => {
  test("pairs every question with an accepted answer", () => {
    expect(faqJsonLd([{ question: "怎么找 Telegram 频道？", answer: "按分类浏览。" }])).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "怎么找 Telegram 频道？",
          acceptedAnswer: { "@type": "Answer", text: "按分类浏览。" },
        },
      ],
    });
  });
});

describe("entryJsonLd", () => {
  const full = entryJsonLd({
    url: `${siteUrl}/detail/techdaily/`,
    name: "每日科技",
    description: "meta description",
    inLanguage: "zh-CN",
    username: "techdaily",
    entryDescription: "每天分享开发与科技新闻",
    avatarUrl: "https://media.tgbox.cc/avatars/techdaily.jpg",
    tgCreatedAt: "2025-08-02T00:00:00.000Z",
    members: 5000,
  });

  test("describes the page and the Telegram entity it is about", () => {
    expect(full).toMatchObject({
      "@type": "WebPage",
      url: "https://tgbox.cc/detail/techdaily/",
      inLanguage: "zh-CN",
      about: {
        "@type": "Organization",
        alternateName: "@techdaily",
        url: "https://t.me/techdaily",
        sameAs: ["https://t.me/techdaily"],
        foundingDate: "2025-08-02",
        interactionStatistic: {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/FollowAction",
          userInteractionCount: 5000,
        },
      },
    });
    expect(roundTrip(full)).toEqual(full);
  });

  test("leaves out the facts an entry doesn't have rather than emitting nulls", () => {
    const sparse = entryJsonLd({
      url: `${siteUrl}/detail/helperbot/`,
      name: "小助手",
      description: "d",
      inLanguage: "zh-CN",
      username: "helperbot",
      entryDescription: "",
      avatarUrl: null,
      tgCreatedAt: null,
      members: null,
    });
    expect(JSON.stringify(sparse)).not.toContain("null");
    expect(Object.keys(sparse.about ?? {})).toEqual([
      "@type",
      "name",
      "alternateName",
      "url",
      "sameAs",
    ]);
  });
});
