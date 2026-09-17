import { defineCollection } from "astro:content";
import { locales } from "@tgbox/shared";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/**
 * Long-form guides, one markdown file per guide per locale under `src/content/guides/<locale>/`.
 * `slug` pairs the zh and en version of the same article so hreflang resolves; the loader id
 * (`zh/find-telegram-channels`) is never used in a URL.
 *
 * `z` comes from `astro/zod` on purpose: Astro validates frontmatter with its own bundled zod,
 * which is a different instance from the workspace's.
 */
const guides = defineCollection({
  loader: glob({
    base: "./src/content/guides",
    pattern: "**/*.md",
    // The default id generator would use the `slug` field, which the zh and en copies share.
    generateId: ({ entry }) => entry.replace(/\.md$/, ""),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    keywords: z.array(z.string()),
    // Coerced: whether the YAML parser hands back a Date or an ISO string is not ours to rely on.
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    locale: z.enum(locales),
    slug: z.string(),
    /** Rendered as a Q&A section and emitted as FAQPage JSON-LD. */
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  }),
});

export const collections = { guides };
