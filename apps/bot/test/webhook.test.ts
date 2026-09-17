import { exports } from "cloudflare:workers";
import { expect, test } from "vitest";

test("unknown paths return 404", async () => {
  const response = await exports.default.fetch("https://bot.test/");
  expect(response.status).toBe(404);
});

test("webhook without the secret token is rejected", async () => {
  const response = await exports.default.fetch("https://bot.test/webhook", {
    method: "POST",
    body: JSON.stringify({ update_id: 1 }),
  });
  expect(response.status).toBe(401);
});
