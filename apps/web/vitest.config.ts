import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // `cloudflare:workers` only exists inside workerd; the promo redirect route imports `env` from it.
  resolve: {
    alias: {
      "cloudflare:workers": path.join(import.meta.dirname, "test/cloudflare-workers-stub.ts"),
    },
  },
  // e2e/*.spec.ts are Playwright tests (`test:e2e`).
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
