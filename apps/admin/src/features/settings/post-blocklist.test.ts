import { MAX_POST_BLOCKLIST } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { formatPostBlocklist, parsePostBlocklist } from "./post-blocklist.ts";

describe("parsePostBlocklist", () => {
  test.each([
    ["one keyword per line", "vpn\n色情", ["vpn", "色情"]],
    ["trims and drops empty lines", "  vpn  \n\n\t\n 赌博 \n", ["vpn", "赌博"]],
    ["drops repeats, ignoring case", "VPN\nvpn\n 代理 \n代理", ["VPN", "代理"]],
    ["empty text is an empty list", "   \n\n", []],
    ["keeps inner spaces", "免费 节点", ["免费 节点"]],
  ])("%s", (_name, text, expected) => {
    expect(parsePostBlocklist(text).keywords).toEqual(expected);
  });

  test(`keeps at most ${MAX_POST_BLOCKLIST} keywords and reports the rest`, () => {
    const text = Array.from({ length: MAX_POST_BLOCKLIST + 3 }, (_, i) => `k${i}`).join("\n");

    const draft = parsePostBlocklist(text);

    expect(draft.keywords).toHaveLength(MAX_POST_BLOCKLIST);
    expect(draft.dropped).toBe(3);
    expect(draft.keywords.at(-1)).toBe(`k${MAX_POST_BLOCKLIST - 1}`);
  });

  test("round-trips a stored list through the textarea", () => {
    const stored = ["vpn", "赌博", "免费 节点"];

    expect(parsePostBlocklist(formatPostBlocklist(stored)).keywords).toEqual(stored);
  });
});
