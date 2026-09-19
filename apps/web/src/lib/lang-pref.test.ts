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

  test("a Chinese first choice is offered Chinese on an English page", () => {
    expect(langChoice(null, ["zh-TW", "en"], "en")).toEqual({ suggest: "zh" });
    expect(langChoice(null, ["zh-CN"], "zh")).toBeNull();
  });

  test("Chinese further down the list leaves either page alone", () => {
    expect(langChoice(null, ["en-US", "zh-CN"], "zh")).toBeNull();
    expect(langChoice(null, ["en-US", "zh-CN"], "en")).toBeNull();
  });

  test("an unknown stored value or no languages says nothing", () => {
    expect(langChoice("fr", [], "zh")).toBeNull();
  });
});
