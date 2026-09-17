import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // e2e/*.spec.ts are Playwright tests (`test:e2e`).
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
