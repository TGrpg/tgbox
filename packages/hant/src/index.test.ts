import { expect, test } from "vitest";
import { toHant } from "./index.ts";

test("converts character forms without swapping in regional vocabulary", () => {
  expect(toHant("软件发布，后台管理，视频频道")).toBe("軟件發佈，後臺管理，視頻頻道");
});

test("corrects the phrases OpenCC misreads", () => {
  expect(toHant("这是一个中文频道，私聊机器人并发送 /help")).toBe(
    "這是一個中文頻道，私聊機器人並發送 /help",
  );
  expect(toHant("代价是只有管理员能发言，任何人都能加入并发言，看价格并购买")).toBe(
    "代價是只有管理員能發言，任何人都能加入並發言，看價格並購買",
  );
});

test("leaves ASCII and Traditional text alone", () => {
  expect(toHant("https://t.me/example 頻道")).toBe("https://t.me/example 頻道");
});
