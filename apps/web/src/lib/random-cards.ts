import type { RandomShardKey, SiteData } from "@tgbox/shared";

const DESCRIPTION_LENGTH = 140;

/** Minimal card data for the drift bottle, with short keys to keep the static JSON small. */
export function randomCards(data: SiteData, key: RandomShardKey) {
  const byUsername = new Map(data.entries.map((entry) => [entry.username, entry]));
  return (data.randomShards[key] ?? []).flatMap((username) => {
    const entry = byUsername.get(username);
    if (!entry) return [];
    const description = entry.description.replace(/\s+/g, " ").trim();
    return {
      u: entry.username,
      k: entry.kind,
      t: entry.title,
      d: Array.from(description).slice(0, DESCRIPTION_LENGTH).join(""),
      a: entry.avatarUrl,
      m: entry.members,
    };
  });
}
