import { mkdir, rename, rmdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import type { AstroIntegration } from "astro";
import { defineConfig } from "astro/config";
import { checkStaticFileCount, countFiles } from "./src/lib/build-guard.ts";

/**
 * Workers assets `404-page` handling serves the nearest `404.html` up the path, so the English
 * 404 must be `/en/404.html` (Astro emits non-root 404 pages as `/en/404/index.html`).
 */
const localized404: AstroIntegration = {
  name: "tgbox:localized-404",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      const enDir = new URL("en/", dir);
      await mkdir(enDir, { recursive: true });
      await rename(new URL("404/index.html", enDir), new URL("404.html", enDir));
      await rmdir(new URL("404/", enDir));
    },
  },
};

/** Cloudflare static assets allow 20,000 files per version; warn early, fail before deploy does. */
const staticFileBudget: AstroIntegration = {
  name: "tgbox:static-file-budget",
  hooks: {
    "astro:build:done": async ({ dir, logger }) => {
      const count = await countFiles(fileURLToPath(dir));
      const status = checkStaticFileCount(count);
      if (status === "fail") throw new Error(`${count} static files exceed the 20,000-file limit`);
      if (status === "warn")
        logger.warn(`${count} static files: approaching the 20,000-file limit`);
      else logger.info(`${count} static files`);
    },
  },
};

/** `client:search`: see src/lib/search-directive.ts. */
const searchDirective: AstroIntegration = {
  name: "tgbox:search-directive",
  hooks: {
    "astro:config:setup": ({ addClientDirective }) => {
      addClientDirective({
        name: "search",
        entrypoint: fileURLToPath(new URL("./src/lib/search-directive.ts", import.meta.url)),
      });
    },
  },
};

export default defineConfig({
  site: process.env.SITE_URL ?? "http://localhost:4321",
  output: "static",
  // Images and sessions would add bindings we don't use on the free plan.
  // Node prerendering lets pages read the snapshot JSON (SITE_DATA_PATH) from disk at build time.
  adapter: cloudflare({ imageService: "passthrough", prerenderEnvironment: "node" }),
  session: false,
  i18n: {
    defaultLocale: "zh",
    locales: ["zh", "en"],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [react(), searchDirective, localized404, staticFileBudget],
  vite: { plugins: [tailwindcss()] },
});
