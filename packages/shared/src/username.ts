// Telegram allows 5–32 characters for people to pick, but older/reserved names go shorter: @kuai
// has 4, and Telegram's own inline bots (@gif, @vid, @pic) have 3. Accept 3–32 so a real account
// is never refused as "not a link". t.me's own reserved paths (/s/, /c/, /k, /a, /iv) are all
// shorter than 3, so they still never parse as a username.
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;
const HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);

/**
 * Extracts a public Telegram username from user input such as
 * `https://t.me/x`, `t.me/s/x`, `telegram.me/x` or `@x`.
 * Returns null for invite links (`+hash`, `joinchat/…`) and invalid usernames.
 */
export function parseTelegramRef(input: string): string | null {
  let value = input.trim();
  if (!value) return null;

  if (value.startsWith("@")) {
    return normalize(value.slice(1));
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!HOSTS.has(host)) {
    // Bare username without a host, e.g. "durov"
    return url.pathname === "/" && !value.includes("/") ? normalize(value) : null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "s") segments.shift();
  value = segments[0] ?? "";
  if (value === "joinchat" || value.startsWith("+")) return null;
  return normalize(value);
}

function normalize(username: string): string | null {
  return USERNAME_RE.test(username) ? username : null;
}
