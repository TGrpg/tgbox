import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `cloudflare:workers` only exists inside workerd; the promo redirect and the Mini App
      // routes import `env` from it.
      "cloudflare:workers": path.join(import.meta.dirname, "test/cloudflare-workers-stub.ts"),
      // Astro resolves `@/…` from tsconfig paths; vitest needs it spelled out.
      "@": path.join(import.meta.dirname, "src"),
    },
  },
  // e2e/*.spec.ts are Playwright tests (`test:e2e`).
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
