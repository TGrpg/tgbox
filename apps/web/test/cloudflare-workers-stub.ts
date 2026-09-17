/** Stands in for the workerd-only `cloudflare:workers` module (aliased in vitest.config.ts). */
export const env = {
  DB: {},
  /** Replaced per test where the upload route's writes are asserted. */
  MEDIA: { put: async (..._args: unknown[]) => {} },
  R2_PUBLIC_URL: "https://media.test",
  /** The Mini App tests sign their initData with this. */
  BOT_TOKEN: "123456:test-token",
};
