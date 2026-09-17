import { describe, expect, test } from "vitest";
import { fixture } from "./fixtures.ts";
import { classifyLiveness } from "./liveness.ts";

const ok = (name: string) => ({ status: 200, html: fixture(name) });

describe("classifyLiveness", () => {
  test.each([
    ["network error / timeout", null],
    ["429", { status: 429, html: "" }],
    ["500", { status: 500, html: "" }],
    ["503", { status: 503, html: fixture("profile-channel.html") }],
    ["challenge / malformed page", ok("malformed.html")],
  ])("transport failure → unknown: %s", (_label, profileResponse) => {
    expect(classifyLiveness({ profileResponse, previousKind: "channel" })).toEqual({
      liveness: "unknown",
      kind: null,
    });
  });

  test("view page without avatar/extra → banned", () => {
    expect(
      classifyLiveness({ profileResponse: ok("profile-banned.html"), previousKind: "channel" }),
    ).toEqual({ liveness: "banned", kind: null });
  });

  test("contact page without avatar/extra → not_found", () => {
    expect(
      classifyLiveness({ profileResponse: ok("profile-not-found.html"), previousKind: "bot" }),
    ).toEqual({ liveness: "not_found", kind: null });
  });

  test.each([
    ["profile-channel.html", "channel"],
    ["profile-group.html", "group"],
    ["profile-bot.html", "bot"],
  ] as const)("%s with matching stored kind → active", (name, kind) => {
    expect(classifyLiveness({ profileResponse: ok(name), previousKind: kind })).toEqual({
      liveness: "active",
      kind,
    });
  });

  test("kind differs from the stored one → type_changed", () => {
    expect(
      classifyLiveness({ profileResponse: ok("profile-group.html"), previousKind: "channel" }),
    ).toEqual({ liveness: "type_changed", kind: "group" });
    expect(
      classifyLiveness({ profileResponse: ok("profile-user.html"), previousKind: "channel" }),
    ).toEqual({ liveness: "type_changed", kind: "user" });
  });

  test("new submission (no stored kind) reports the detected kind", () => {
    expect(
      classifyLiveness({ profileResponse: ok("profile-user.html"), previousKind: null }),
    ).toEqual({ liveness: "active", kind: "user" });
  });

  test("channel whose /s/ preview now redirects → banned", () => {
    expect(
      classifyLiveness({
        profileResponse: ok("profile-channel.html"),
        previousKind: "channel",
        previewRedirected: true,
      }),
    ).toEqual({ liveness: "banned", kind: "channel" });
  });
});
