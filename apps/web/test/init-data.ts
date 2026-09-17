import { createHmac } from "node:crypto";

/** The bot token the `cloudflare:workers` stub hands to the routes. */
export const BOT_TOKEN = "123456:test-token";

/** Builds a Mini App launch string signed the way Telegram signs it. */
export function initData(
  user: { id: number; first_name?: string; language_code?: string },
  options: { authDateMs?: number; token?: string } = {},
) {
  const params = new URLSearchParams({
    query_id: "AAE",
    user: JSON.stringify(user),
    auth_date: String(Math.floor((options.authDateMs ?? Date.now()) / 1000)),
  });
  const checkString = [...params.entries()]
    .map((pair) => pair.join("="))
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update(options.token ?? BOT_TOKEN)
    .digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}
