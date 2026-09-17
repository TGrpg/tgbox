import { expect, test } from "vitest";
import { devSiteData } from "./dev-site-data.ts";
import { randomCards } from "./random-cards.ts";

test("bottle cards follow the shard and carry what the card shows", () => {
  const data = {
    ...devSiteData,
    randomShards: { ...devSiteData.randomShards, channel: ["durov", "missing", "telegram"] },
  };
  const cards = randomCards(data, "channel");
  expect(cards.map((card) => card.u)).toEqual(["durov", "telegram"]);
  expect(cards[1]).toMatchObject({ t: "Telegram News", k: "channel", m: 9_870_000, a: null });
  expect(cards[1]?.d.length).toBeLessThanOrEqual(140);
});

test("long descriptions are shortened on one line", () => {
  const entry = devSiteData.entries[0];
  if (!entry) throw new Error("dev data has entries");
  const data = {
    ...devSiteData,
    entries: [{ ...entry, description: `line one\n${"x".repeat(300)}` }],
    randomShards: { all: [entry.username], channel: [], group: [], bot: [] },
  };
  const [card] = randomCards(data, "all");
  expect(card?.d.startsWith("line one x")).toBe(true);
  expect(card?.d.length).toBe(140);
});
