/**
 * JSON-LD builders. Only types that a search engine can act on, or that make the page legible to
 * an answer engine, are emitted — see `docs/seo.md` for what each one is (and is no longer) worth.
 */

export type JsonLd = Record<string, unknown>;

const CONTEXT = "https://schema.org";

/** One entity for the whole site, referenced by `publisher` on every locale's home page. */
export function organizationId(siteUrl: string) {
  return `${siteUrl}/#organization`;
}

export function organizationJsonLd(input: {
  siteUrl: string;
  name: string;
  description: string;
  logo: string;
  /** Profiles that prove the same entity: the GitHub repo, the Telegram bot. */
  sameAs: string[];
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": organizationId(input.siteUrl),
    name: input.name,
    url: `${input.siteUrl}/`,
    logo: input.logo,
    description: input.description,
    sameAs: input.sameAs,
  };
}

export function websiteJsonLd(input: {
  siteUrl: string;
  /** Absolute URL of this locale's home page. */
  url: string;
  name: string;
  description: string;
  inLanguage: string;
  /** Search URL with a literal `{search_term_string}` placeholder; omitted when absent. */
  searchUrlTemplate?: string | undefined;
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": `${input.url}#website`,
    url: input.url,
    name: input.name,
    description: input.description,
    inLanguage: input.inLanguage,
    publisher: { "@id": organizationId(input.siteUrl) },
    ...(input.searchUrlTemplate
      ? {
          potentialAction: {
            "@type": "SearchAction",
            target: { "@type": "EntryPoint", urlTemplate: input.searchUrlTemplate },
            "query-input": "required name=search_term_string",
          },
        }
      : {}),
  };
}

/** The trail as rendered on the page; the current page is the last item and carries no URL. */
export function breadcrumbJsonLd(items: { name: string; url?: string | undefined }[]): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };
}

/** The entries actually rendered on a listing page, in the order they appear. */
export function itemListJsonLd(input: {
  name: string;
  url: string;
  items: { name: string; url: string }[];
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "ItemList",
    name: input.name,
    url: input.url,
    numberOfItems: input.items.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: input.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

export function faqJsonLd(items: { question: string; answer: string }[]): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/** A detail page: the page itself, plus the Telegram entity it is about. */
export function entryJsonLd(input: {
  url: string;
  name: string;
  description: string;
  inLanguage: string;
  username: string;
  entryDescription: string;
  avatarUrl: string | null;
  tgCreatedAt: string | null;
  members: number | null;
}): JsonLd {
  const tmeUrl = `https://t.me/${input.username}`;
  return {
    "@context": CONTEXT,
    "@type": "WebPage",
    url: input.url,
    name: input.name,
    description: input.description,
    inLanguage: input.inLanguage,
    about: {
      "@type": "Organization",
      name: input.name,
      alternateName: `@${input.username}`,
      url: tmeUrl,
      sameAs: [tmeUrl],
      ...(input.entryDescription ? { description: input.entryDescription } : {}),
      ...(input.avatarUrl ? { logo: input.avatarUrl, image: input.avatarUrl } : {}),
      ...(input.tgCreatedAt ? { foundingDate: input.tgCreatedAt.slice(0, 10) } : {}),
      ...(input.members !== null
        ? {
            interactionStatistic: {
              "@type": "InteractionCounter",
              interactionType: "https://schema.org/FollowAction",
              userInteractionCount: input.members,
            },
          }
        : {}),
    },
  };
}
