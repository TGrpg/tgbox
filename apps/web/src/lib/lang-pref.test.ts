import { describe, expect, test } from "vitest";
import { langChoice } from "./lang-pref.ts";

describe("langChoice", () => {
  test("a stored choice is followed, and nothing happens on its own page", () => {
    expect(langChoice("en", ["zh-CN"], "zh")).toEqual({ redirect: "en" });
    expect(langChoice("zh", ["en-US"], "en")).toEqual({ redirect: "zh" });
    expect(langChoice("zh", ["en-US"], "zh")).toBeNull();
  });

  test("a browser without Chinese is offered English on a Chinese page", () => {
    expect(langChoice(null, ["en-US", "en"], "zh")).toEqual({ suggest: "en" });
    expect(langChoice(null, ["ja-JP"], "zh")).toEqual({ suggest: "en" });
    expect(langChoice(null, ["en-US"], "en")).toBeNull();
  });

  test("a Chinese first choice is offered Chinese in its own script", () => {
    expect(langChoice(null, ["zh-CN", "en"], "en")).toEqual({ suggest: "zh" });
    expect(langChoice(null, ["zh"], "zh-hant")).toEqual({ suggest: "zh" });
    expect(langChoice(null, ["zh-CN"], "zh")).toBeNull();
    for (const tag of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-TW"]) {
      expect(langChoice(null, [tag, "en"], "en"), tag).toEqual({ suggest: "zh-hant" });
      expect(langChoice(null, [tag], "zh"), tag).toEqual({ suggest: "zh-hant" });
      expect(langChoice(null, [tag], "zh-hant"), tag).toBeNull();
    }
  });

  test("a stored Traditional choice is followed from any page", () => {
    expect(langChoice("zh-hant", ["en-US"], "zh")).toEqual({ redirect: "zh-hant" });
    expect(langChoice("zh-hant", ["zh-CN"], "en")).toEqual({ redirect: "zh-hant" });
    expect(langChoice("zh", ["zh-TW"], "zh-hant")).toEqual({ redirect: "zh" });
    expect(langChoice("zh-hant", ["zh-CN"], "zh-hant")).toBeNull();
  });

  test("Chinese further down the list leaves either page alone", () => {
    expect(langChoice(null, ["en-US", "zh-CN"], "zh")).toBeNull();
    expect(langChoice(null, ["en-US", "zh-CN"], "en")).toBeNull();
    expect(langChoice(null, ["en-US", "zh-TW"], "zh")).toBeNull();
  });

  test("an unknown stored value or no languages says nothing", () => {
    expect(langChoice("fr", [], "zh")).toBeNull();
  });
});
