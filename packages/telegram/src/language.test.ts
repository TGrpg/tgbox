import { expect, test } from "vitest";
import { detectLanguage } from "./language.ts";

test.each([
  ["科技资讯频道，每天分享最新的软件和开发工具", "zh"],
  ["最新ニュースをお届けします。よろしくお願いします", "ja"],
  ["최신 뉴스와 정보를 매일 전해 드립니다", "ko"],
  ["Новости технологий и программирования каждый день", "ru"],
  ["آخر الأخبار والمعلومات من حول العالم كل يوم", "ar"],
  ["آخرین اخبار و اطلاعات فناوری را اینجا بخوانید چگونه", "fa"],
  ["The official Telegram on Telegram. Much recursion. Very Telegram. Wow.", "en"],
  ["Las últimas noticias de tecnología y programación cada día en este canal", "es"],
  ["Die neuesten Nachrichten über Technologie und Programmierung jeden Tag", "de"],
  ["科技 news channel 每日更新软件资讯 and tools", "zh"],
  ["東京の天気は晴れです。明日は雨が降るでしょう", "ja"],
  ["Newlearnerの自留地\n不定期推送 IT 相关资讯，欢迎关注！投稿请私信 @newlearner_pm_bot", "zh"],
  ["Beta发布通知频道： @Legado_Beta Beta发布讨论群组： @Beta_Legado", "zh"],
  ["资源分享 https://example.com/some/very/long/english/path t.me/some_channel", "zh"],
  // Short Latin text: franc guesses wildly, so non-English needs language-specific evidence.
  [
    "Miss Rose\nPowerful telegram bot to help you manage your groups.\nUpdates in @RoseNews.\n\nGet your own clone at @RoseClone_bot!",
    "en",
  ],
  ["Powerful telegram bot to help you manage your groups.", "en"],
  ["Bonjour à tous, voilà le café du coin", "fr"],
  ["Hola, bienvenidos al canal de noticias de tecnología", "es"],
  ["", "und"],
  ["12345 !!! 🚀", "und"],
])("%s → %s", (text, expected) => {
  expect(detectLanguage(text)).toBe(expected);
});
