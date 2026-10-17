import type { EntryKind } from "./domain.ts";
import { parseTelegramRef } from "./username.ts";

const PAYLOAD_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);
export const isStartPayload = (value: unknown): value is string =>
  typeof value === "string" && PAYLOAD_RE.test(value);

export type TelegramTarget = {
  username: string;
  kind: EntryKind;
  startPayload?: string | null;
};

/** Only an explicitly reviewed bot payload is retained; no other query survives. */
export function telegramLinks(target: TelegramTarget) {
  if (parseTelegramRef(`@${target.username}`) !== target.username)
    throw new Error("Invalid username");
  const start =
    target.kind === "bot" && isStartPayload(target.startPayload) ? target.startPayload : null;
  const query = start ? `?${new URLSearchParams({ start })}` : "";
  const nativeQuery = new URLSearchParams({ domain: target.username });
  const goQuery = new URLSearchParams({ u: target.username });
  if (start) {
    nativeQuery.set("start", start);
    goQuery.set("kind", "bot");
    goQuery.set("start", start);
  }
  return {
    web: `https://t.me/${target.username}${query}`,
    native: `tg://resolve?${nativeQuery}`,
    goQuery: goQuery.toString(),
    mirror(host: string) {
      if (!HOSTS.has(host)) throw new Error("Invalid Telegram mirror");
      return `https://${host}/${target.username}${query}`;
    },
  };
}

/** Validate the /go transport separately, including duplicate keys. */
export function goTelegramTarget(query: URLSearchParams): TelegramTarget | null {
  if (
    query.getAll("u").length !== 1 ||
    query.getAll("start").length > 1 ||
    query.getAll("kind").length > 1
  )
    return null;
  const username = parseTelegramRef(`@${(query.get("u") ?? "").replace(/^@/, "")}`);
  const startPayload = query.get("start");
  if (
    !username ||
    (startPayload !== null && (query.get("kind") !== "bot" || !isStartPayload(startPayload)))
  )
    return null;
  return { username, kind: query.get("kind") === "bot" ? "bot" : "channel", startPayload };
}
