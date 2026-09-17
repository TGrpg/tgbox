import { expect, test } from "vitest";
import { linkify } from "./linkify.ts";

const link = (href: string, text = href) =>
  `<a href="${href}" rel="nofollow ugc noopener" target="_blank">${text}</a>`;

test.each([
  ["plain text", "plain text"],
  ['<b>bold</b> & "quotes"', "&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;"],
  ["see https://example.com/a?b=1&c=2.", `see ${link("https://example.com/a?b=1&amp;c=2")}.`],
  ["(http://x.io/path)", `(${link("http://x.io/path")})`],
  ["contact @some_user now", `contact ${link("https://t.me/some_user", "@some_user")} now`],
  ["mail me@example.com", "mail me@example.com"],
  ["javascript:alert(1)", "javascript:alert(1)"],
  ['https://evil.com/"onmouseover="x', `${link("https://evil.com/")}&quot;onmouseover=&quot;x`],
])("linkify(%j)", (input, expected) => {
  expect(linkify(input)).toBe(expected);
});
