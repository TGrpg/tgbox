import { MAX_POST_BLOCKLIST } from "@tgbox/shared";

export type PostBlocklistDraft = {
  keywords: string[];
  /** Unique keywords beyond the cap; they are not saved. */
  dropped: number;
};

/** Textarea → stored list: one keyword per line, trimmed, empty lines and repeats dropped. */
export function parsePostBlocklist(text: string): PostBlocklistDraft {
  const seen = new Set<string>();
  const keywords: string[] = [];
  let dropped = 0;
  for (const line of text.split("\n")) {
    const keyword = line.trim();
    const key = keyword.toLowerCase();
    if (keyword === "" || seen.has(key)) continue;
    seen.add(key);
    if (keywords.length < MAX_POST_BLOCKLIST) keywords.push(keyword);
    else dropped += 1;
  }
  return { keywords, dropped };
}

export const formatPostBlocklist = (keywords: string[]) => keywords.join("\n");
