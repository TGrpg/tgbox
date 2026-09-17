import { test as base, expect } from "@playwright/test";

/** Every page runs offline: fixture avatars and Telegram hosts must never be fetched. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4329\/)/, (route) => route.abort());
    await use(page);
  },
});

export { expect };
