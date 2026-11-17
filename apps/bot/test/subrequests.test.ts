import { env } from "cloudflare:workers";
import { createDb, getSiteState } from "@tgbox/db";
import { expect, test } from "vitest";
import { countSubrequests } from "../src/subrequests.ts";

test("every query, batch and fetch counts once, failed ones included", async () => {
  const counter = countSubrequests(env.DB, async () => new Response("ok"));
  const raw = counter.db;
  await raw.prepare("SELECT 1").all();
  await raw.prepare("SELECT ?").bind(2).first();
  await raw.batch([raw.prepare("SELECT 1"), raw.prepare("SELECT ?").bind(3)]);
  await expect(raw.prepare("SELECT * FROM no_such_table").all()).rejects.toThrow();
  expect(counter.used()).toBe(4);

  // Drizzle goes through the same binding.
  await getSiteState(createDb(raw), "dirty_since");
  await counter.fetch("https://example.com/");
  expect(counter.used()).toBe(6);
});
