import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "../../packages/db/migrations"),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // The `ai` binding would otherwise open a remote proxy session against Cloudflare on
        // startup. Tests are local only; `AI` is faked in the harness env.
        remoteBindings: false,
        miniflare: {
          // The pool bundles an older workerd (miniflare 5.20260815) that rejects newer dates.
          compatibilityDate: "2026-08-15",
          bindings: {
            TEST_MIGRATIONS: migrations,
            BOT_TOKEN: "123456:TEST",
            WEBHOOK_SECRET: "test-secret",
            GITHUB_DISPATCH_TOKEN: "test-token",
            SETTINGS_KEY: "test-settings-key",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
