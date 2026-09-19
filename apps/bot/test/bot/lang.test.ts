import { getUserLocale, setUserLocale } from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import { botCommands } from "../../src/bot/index.ts";
import { db, type Harness, startHarness } from "./harness.ts";

const english = { id: 555, is_bot: false, first_name: "Ann", language_code: "en" };
const chinese = { id: 556, is_bot: false, first_name: "小明", language_code: "zh-hans" };
const traditional = { id: 557, is_bot: false, first_name: "小華", language_code: "zh-hant" };

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});

describe("/lang", () => {
  test("offers every language plus auto and confirms in the new one", async () => {
    await h.message(english, "/lang");
    expect(h.lastText()).toBe("Choose the bot language:");
    expect(h.lastButtons().map((b) => b.callback_data)).toEqual([
      "lang:zh",
      "lang:zh-hant",
      "lang:en",
      "lang:auto",
    ]);
    expect(h.lastButtons().map((b) => b.text)).toEqual([
      "简体中文",
      "繁體中文",
      "English",
      "自动 / Auto",
    ]);

    await h.callback(english, "lang:zh");
    expect(h.lastText()).toContain("已切换到中文");
    expect(await getUserLocale(db, english.id)).toBe("zh");
  });

  test("the stored preference wins over the Telegram client language", async () => {
    await h.message(english, "/help");
    expect(h.lastText()).toContain("Listing criteria");

    await h.callback(english, "lang:zh");
    await h.message(english, "/help");
    expect(h.lastText()).toContain("收录标准");
    // The submission flow follows the same preference.
    await h.message(english, "/submit");
    expect(h.lastText()).toContain("请发送要提交的频道");
  });

  test("auto clears the preference and the language heuristic applies again", async () => {
    await setUserLocale(db, english.id, "zh", Date.now());
    await h.callback(english, "lang:auto");
    expect(h.lastText()).toContain("follows your Telegram client language");
    expect(await getUserLocale(db, english.id)).toBeNull();
    await h.message(english, "/help");
    expect(h.lastText()).toContain("Listing criteria");
  });

  test("a Chinese client can switch to English", async () => {
    await h.message(chinese, "/lang");
    expect(h.lastText()).toBe("请选择机器人语言：");
    await h.callback(chinese, "lang:en");
    expect(h.lastText()).toContain("Language set to English");
    await h.message(chinese, "/start");
    expect(h.lastText()).toContain("Welcome to the TGbox");
  });

  test("picking a language pushes a matching command menu for that chat only", async () => {
    await h.callback(english, "lang:zh");
    const [call] = h.calls("setMyCommands");
    expect(call?.payload.scope).toEqual({ type: "chat", chat_id: english.id });
    expect(call?.payload.commands).toEqual([
      { command: "submit", description: "提交收录" },
      { command: "promote", description: "购买推广" },
      { command: "support", description: "联系客服" },
      { command: "lang", description: "切换语言 / Language" },
      { command: "help", description: "使用帮助" },
    ]);

    h.reset();
    await h.callback(chinese, "lang:en");
    expect(h.calls("setMyCommands")[0]?.payload.commands).toEqual(botCommands("en"));
  });

  test("auto removes the chat menu so the global lists apply again", async () => {
    await h.callback(english, "lang:auto");
    expect(h.calls("setMyCommands")).toEqual([]);
    expect(h.calls("deleteMyCommands")[0]?.payload).toEqual({
      scope: { type: "chat", chat_id: english.id },
    });
  });

  test("a failing command menu update doesn't break the language switch", async () => {
    h.failOnce("setMyCommands", "Bad Request: too many commands");
    await h.callback(english, "lang:zh");
    expect(h.lastText()).toContain("已切换到中文");
    expect(await getUserLocale(db, english.id)).toBe("zh");
  });

  test("a Traditional Chinese client is answered in Traditional without asking", async () => {
    for (const code of ["zh-hant", "zh-tw", "zh-HK"]) {
      await h.message({ ...traditional, language_code: code }, "/help");
      expect(h.lastText(), code).toContain("收錄標準");
    }
    await h.message(traditional, "/lang");
    expect(h.lastText()).toBe("請選擇機器人語言：");
  });

  test("Traditional can be chosen, is remembered and gets its own command menu", async () => {
    await h.callback(chinese, "lang:zh-hant");
    expect(h.lastText()).toContain("已切換到中文");
    expect(await getUserLocale(db, chinese.id)).toBe("zh-hant");
    expect(h.calls("setMyCommands")[0]?.payload.commands).toContainEqual({
      command: "submit",
      description: "提交收錄",
    });
    await h.message(chinese, "/help");
    expect(h.lastText()).toContain("收錄標準");
    // A Traditional client can go back to Simplified the same way.
    await h.callback(traditional, "lang:zh");
    await h.message(traditional, "/help");
    expect(h.lastText()).toContain("收录标准");
  });

  test("/start offers a language button that opens the picker", async () => {
    await h.message(chinese, "/start");
    expect(h.lastButtons().map((b) => b.callback_data)).toContain("lang");
    await h.callback(chinese, "lang");
    expect(h.lastText()).toBe("请选择机器人语言：");
  });
});
