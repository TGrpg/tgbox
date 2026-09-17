import { type RankItem, RankingsData } from "@tgbox/shared";
import type { App } from "./bot/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 01:00 UTC = 09:00 Beijing. */
export const DIGEST_UTC_HOUR = 1;
const MAX_NEW = 10;
const MAX_GROWTH = 5;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Daily channel digest from the static `/data/rankings.json` (a static asset: no Worker request,
 * no D1 writes). The hourly cron calls it at DIGEST_UTC_HOUR only, so no "last sent" marker.
 */
export async function runDailyDigest(app: App, scheduledTime: number) {
  const { publishChannelId, dailyDigest } = (await app.settings()).bot;
  if (!publishChannelId || !dailyDigest) return { sent: false, reason: "disabled" };

  const site = app.env.SITE_URL.replace(/\/$/, "");
  let rankings: RankingsData;
  try {
    const res = await app.fetch(`${site}/data/rankings.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rankings = RankingsData.parse(await res.json());
  } catch (error) {
    console.error("daily digest: rankings.json unavailable", error);
    return { sent: false, reason: "rankings" };
  }

  const fresh = rankings.newest
    .filter((item) => {
      const listedAt = Date.parse(item.listedAt);
      return listedAt > scheduledTime - DAY_MS && listedAt <= scheduledTime;
    })
    .slice(0, MAX_NEW);
  const growing = rankings.weeklyGrowth
    .filter((item) => item.growth !== null && item.growth > 0)
    .slice(0, MAX_GROWTH);
  if (fresh.length === 0 && growing.length === 0) return { sent: false, reason: "empty" };

  const line = (item: RankItem) => {
    const growth =
      item.growth !== null && item.growth > 0 ? ` +${item.growth.toLocaleString("en")}` : "";
    const href = `${site}/detail/${encodeURIComponent(item.username)}/`;
    return `<a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a> @${escapeHtml(item.username)}${growth}`;
  };
  const sections = [
    ...(fresh.length ? [["🆕 今日新收录", ...fresh.map(line)].join("\n")] : []),
    ...(growing.length ? [["📈 本周涨粉榜", ...growing.map(line)].join("\n")] : []),
  ];
  const text = [
    "📊 TGbox 日报",
    ...sections,
    `<a href="${escapeHtml(`${site}/rank/`)}">查看完整榜单 »</a>`,
  ].join("\n\n");

  await app.api.sendMessage(publishChannelId, text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  return { sent: true, fresh: fresh.length, growing: growing.length };
}
