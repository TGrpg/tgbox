import type { Page } from "@playwright/test";
import { expect, test } from "./test.ts";

/** Islands hydrate on idle; wait for it before using keyboard shortcuts. */
async function searchReady(page: Page) {
  await expect(page.locator("astro-island:not([ssr])")).toHaveCount(1);
}

test("Ctrl+K search finds an entry by a Chinese keyword and opens it", async ({ page }) => {
  await page.goto("/");
  await searchReady(page);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.locator("[data-search-dialog]");
  await expect(dialog).toBeVisible();
  // The spring open animation settles at full opacity and scale.
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(dialog).toHaveCSS("transform", "none");
  await dialog.getByRole("combobox").fill("科技");
  const result = dialog.locator("[data-search-result]", { hasText: "开发者日报" });
  await expect(result).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/detail\/devnews_cn\/$/);
});

test("search dialog closes with Escape after its exit animation", async ({ page }) => {
  await page.goto("/");
  await searchReady(page);
  await page.locator("#site-search").click();
  const dialog = page.locator("[data-search-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("search results on English pages link to English detail pages", async ({ page }) => {
  await page.goto("/en/");
  await searchReady(page);
  await page.locator("#site-search").click();
  await page.locator("[data-search-dialog]").getByRole("combobox").fill("开发者日报");
  await expect(page.locator("[data-search-result]").first()).toHaveAttribute(
    "href",
    "/en/detail/devnews_cn/",
  );
});

test("drift bottle shows an entry and fishes again within the chosen kind", async ({ page }) => {
  await page.goto("/random/");
  const card = page.locator("article[data-bottle-card]");
  await expect(card).toBeVisible();
  await expect(card.locator("[data-card-title]")).not.toBeEmpty();

  const channelTab = page.getByRole("tab", { name: "频道", exact: true });
  await channelTab.click();
  await expect(channelTab).toHaveAttribute("aria-selected", "true");
  await expect(card).toHaveAttribute("data-shard", "channel");
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await card.getAttribute("data-bottle-card");
    await page.getByRole("button", { name: "再捞一个" }).click();
    await expect(card).not.toHaveAttribute("data-bottle-card", previous ?? "");
    await expect(card.locator("[data-card-kind]")).toHaveText("频道");
    const href = await card.locator("[data-card-title]").getAttribute("href");
    expect(href).toMatch(/^\/detail\/(telegram|durov|devnews_cn)\/$/);
    seen.add(href ?? "");
  }
  expect(seen.size).toBeGreaterThan(1);
  await card.locator("[data-card-title]").click();
  await expect(page).toHaveURL(/\/detail\/(telegram|durov|devnews_cn)\/$/);
});

test("language switch on a detail page goes to the English detail page", async ({ page }) => {
  await page.goto("/detail/devnews_cn/");
  await page.locator("[data-lang-switch=en]").first().click();
  await expect(page).toHaveURL(/\/en\/detail\/devnews_cn\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("go page shows the entry and three Telegram routes", async ({ page }) => {
  await page.goto("/go/?u=telegram");
  await expect(page.locator("[data-go-title]")).toHaveText("Telegram News");
  await expect(page.locator("[data-go-target]")).toHaveText("@telegram");
  const routes = page.locator("[data-go-host]");
  await expect(routes).toHaveCount(3);
  await expect(routes.first()).toHaveAttribute("href", "https://t.me/telegram");
  await expect(page.locator("[data-go-app]")).toHaveAttribute(
    "href",
    "tg://resolve?domain=telegram",
  );
  // Every Telegram host is unreachable offline, so no auto-redirect starts.
  await expect(page.locator("[data-go-status]")).toContainText("所有域名都连不上");
  await expect(page).toHaveURL(/\/go\/\?u=telegram$/);
});

test("category sidebar only lists categories that have a page", async ({ page }) => {
  await page.goto("/channel/");
  const sidebar = page.locator("aside.category-sidebar");
  expect(await sidebar.locator("li").count()).toBeGreaterThan(1);
  // Empty categories are left out entirely, so every row is a link to a page that exists.
  expect(await sidebar.locator("li > :not(a)").count()).toBe(0);
  for (const href of await sidebar
    .locator("a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""))) {
    expect((await page.request.get(href)).status(), href).toBe(200);
  }
});

test("mobile tab bar navigates between sections", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const tabBar = page.locator("nav.mobile-tab-bar");
  await expect(tabBar).toBeVisible();
  await tabBar.getByRole("link", { name: "群组" }).click();
  await expect(page).toHaveURL(/\/group\/$/);
  await expect(page.locator("nav.mobile-tab-bar [aria-current=page]")).toHaveText("群组");
  await page.locator("nav.mobile-tab-bar").getByRole("link", { name: "首页" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:4329\/$/);
});

test("share dialog opens, copies with a toast and closes", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/detail/telegram/");
  await page.locator("[data-share-open]").first().click();
  const dialog = page.locator("dialog[data-share-dialog]");
  await expect(dialog).toBeVisible();
  await dialog.locator("[data-copy]").click();
  await expect(page.locator("[data-toast]")).toHaveText("已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /\/detail\/telegram\/$/,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
