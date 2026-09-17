import { describe, expect, test } from "vitest";
import { fixture } from "./fixtures.ts";
import { fetchEntrySnapshot } from "./snapshot.ts";

const now = new Date("2026-05-20T00:00:00Z");

type Route = Response | "throw";

function fakeFetch(routes: Record<string, () => Route>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    const res = route?.();
    if (!res || res === "throw") throw new TypeError("network error");
    return res;
  };
  return { fetch, calls };
}

const html = (name: string) => () => new Response(fixture(name), { status: 200 });
const redirect = (location: string) => () =>
  new Response(null, { status: 302, headers: { location } });

describe("fetchEntrySnapshot", () => {
  test("active channel: profile + /s/ + first post, with browser UA and manual redirects", async () => {
    const { fetch, calls } = fakeFetch({
      "https://t.me/telegram": html("profile-channel.html"),
      "https://t.me/s/telegram": html("channel-posts.html"),
      "https://t.me/s/telegram/1": html("channel-first-post.html"),
    });
    const snap = await fetchEntrySnapshot("telegram", {
      fetch,
      now,
      knownKind: "channel",
      needCreatedAt: true,
    });
    expect(snap).toMatchObject({
      liveness: "active",
      kind: "channel",
      createdAt: "2015-09-21T02:14:24+00:00",
      lang: "en",
      subrequests: 3,
      rateLimited: false,
    });
    expect(snap.profile?.members).toBe(9538357);
    expect(snap.posts).toHaveLength(20);
    expect(snap.activityTier).not.toBeNull();
    for (const call of calls) {
      expect(new Headers(call.init?.headers).get("user-agent")).toMatch(/Mozilla\/5\.0/);
    }
    expect(calls[1]?.init?.redirect).toBe("manual");
  });

  test("group: only the profile is fetched, no tier", async () => {
    const { fetch } = fakeFetch({ "https://t.me/grammyjs": html("profile-group.html") });
    const snap = await fetchEntrySnapshot("grammyjs", {
      fetch,
      now,
      knownKind: "group",
      needCreatedAt: true,
    });
    expect(snap).toMatchObject({
      liveness: "active",
      kind: "group",
      posts: null,
      createdAt: null,
      activityTier: null,
      subrequests: 1,
    });
  });

  test("channel whose /s/ now redirects → banned", async () => {
    const { fetch } = fakeFetch({
      "https://t.me/telegram": html("profile-channel.html"),
      "https://t.me/s/telegram": redirect("https://t.me/telegram"),
    });
    const snap = await fetchEntrySnapshot("telegram", {
      fetch,
      now,
      knownKind: "channel",
      needCreatedAt: true,
    });
    expect(snap).toMatchObject({
      liveness: "banned",
      posts: null,
      createdAt: null,
      subrequests: 2,
    });
  });

  test("new submission of a channel with redirecting preview stays active", async () => {
    const { fetch } = fakeFetch({
      "https://t.me/telegram": html("profile-channel.html"),
      "https://t.me/s/telegram": redirect("https://t.me/telegram"),
    });
    const snap = await fetchEntrySnapshot("telegram", {
      fetch,
      now,
      knownKind: null,
      needCreatedAt: false,
    });
    expect(snap).toMatchObject({ liveness: "active", kind: "channel", posts: null });
  });

  test("429 → unknown and flagged as rate limited", async () => {
    const { fetch } = fakeFetch({
      "https://t.me/telegram": () => new Response("Too Many Requests", { status: 429 }),
    });
    const snap = await fetchEntrySnapshot("telegram", {
      fetch,
      now,
      knownKind: "channel",
      needCreatedAt: true,
    });
    expect(snap).toMatchObject({
      liveness: "unknown",
      profile: null,
      rateLimited: true,
      subrequests: 1,
    });
  });

  test("429 on the /s/ page keeps profile liveness but flags rate limiting", async () => {
    const { fetch } = fakeFetch({
      "https://t.me/telegram": html("profile-channel.html"),
      "https://t.me/s/telegram": () => new Response("", { status: 429 }),
    });
    const snap = await fetchEntrySnapshot("telegram", {
      fetch,
      now,
      knownKind: "channel",
      needCreatedAt: true,
    });
    expect(snap).toMatchObject({
      liveness: "active",
      posts: null,
      rateLimited: true,
      subrequests: 2,
    });
  });

  test.each([
    ["network error", () => "throw" as const],
    ["5xx", () => new Response("", { status: 502 })],
    ["malformed page", html("malformed.html")],
  ])("%s → unknown, never throws", async (_label, route) => {
    const { fetch } = fakeFetch({ "https://t.me/BotFather": route });
    const snap = await fetchEntrySnapshot("BotFather", {
      fetch,
      now,
      knownKind: "bot",
      needCreatedAt: false,
    });
    expect(snap).toMatchObject({ liveness: "unknown", rateLimited: false, subrequests: 1 });
  });

  test("not found profile", async () => {
    const { fetch } = fakeFetch({
      "https://t.me/zzqq_not_exist_987654": html("profile-not-found.html"),
    });
    const snap = await fetchEntrySnapshot("zzqq_not_exist_987654", {
      fetch,
      now,
      knownKind: "bot",
      needCreatedAt: false,
    });
    expect(snap).toMatchObject({ liveness: "not_found", kind: null, lang: null, subrequests: 1 });
  });
});
