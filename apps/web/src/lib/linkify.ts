const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

// URLs stop at whitespace, quotes and angle brackets; @mentions must not follow a word char (emails).
const TOKEN = /(https?:\/\/[^\s<>"']+)|(?<![\w@])@([a-zA-Z]\w{3,31})\b/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}，。；：！？）】]+$/;

function anchor(href: string, text: string) {
  return `<a href="${escapeHtml(href)}" rel="nofollow ugc noopener" target="_blank">${escapeHtml(text)}</a>`;
}

/** Escapes untrusted Telegram text and turns http(s) URLs and @mentions into links. */
export function linkify(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [raw, url, mention] = match;
    let token = raw;
    if (url) token = url.replace(TRAILING_PUNCTUATION, "");
    html += escapeHtml(text.slice(last, match.index));
    html += url ? anchor(token, token) : anchor(`https://t.me/${mention}`, token);
    last = match.index + token.length;
  }
  return html + escapeHtml(text.slice(last));
}
