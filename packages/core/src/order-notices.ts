import { getUserLocale, type Order } from "@tgbox/db";
import { isEntryProduct, type ProductKind, type SiteLocale } from "@tgbox/shared";
import { background, type CoreContext } from "./context.ts";
import { getSettings } from "./settings.ts";

/**
 * What a buyer is told when an admin acts on their paid order, from the bot's review chat or from
 * the admin alike: the message is sent here, by the operation itself, so both places say the same
 * thing exactly once. In the buyer's bot language when they chose one, else both.
 */

type Words = {
  kinds: Record<ProductKind, string>;
  title: (kind: string, title: string) => string;
  entryStarted: (target: string, ends: string) => string;
  adStarted: (target: string, ends: string) => string;
  refunded: (orderId: number) => string;
  entryRefused: string;
  adRefused: string;
  starsBack: (lead: string) => string;
  contact: (lead: string, orderId: number, support: string | null) => string;
};

const words: Record<SiteLocale, Words> = {
  zh: {
    kinds: {
      highlight: "高亮",
      category_pin: "分类置顶",
      pin: "全站置顶",
      banner: "首页横幅",
      announcement: "顶部公告条",
    },
    title: (kind, title) => `${kind}「${title}」`,
    entryStarted: (target, ends) =>
      `🎉 你的推广（${target}）已上线，展示至 ${ends}。网站几分钟后更新。`,
    adStarted: (target, ends) => `🎉 你的广告（${target}）已通过审核并上线，展示至 ${ends}。`,
    refunded: (id) => `订单 #${id} 的款项已退回给你。`,
    entryRefused: "很抱歉，你的推广没能上线",
    adRefused: "很抱歉，你的广告未通过审核",
    starsBack: (lead) => `${lead}，Stars 已原路退回。`,
    contact: (lead, id, support) =>
      `${lead}。请联系客服${support ? ` @${support}` : ""}办理退款（订单 #${id}）。`,
  },
  "zh-hant": {
    kinds: {
      highlight: "高亮",
      category_pin: "分類置頂",
      pin: "全站置頂",
      banner: "首頁橫幅",
      announcement: "頂部公告條",
    },
    title: (kind, title) => `${kind}「${title}」`,
    entryStarted: (target, ends) =>
      `🎉 你的推廣（${target}）已上線，展示至 ${ends}。網站幾分鐘後更新。`,
    adStarted: (target, ends) => `🎉 你的廣告（${target}）已通過審核並上線，展示至 ${ends}。`,
    refunded: (id) => `訂單 #${id} 的款項已退回給你。`,
    entryRefused: "很抱歉，你的推廣沒能上線",
    adRefused: "很抱歉，你的廣告未通過審核",
    starsBack: (lead) => `${lead}，Stars 已原路退回。`,
    contact: (lead, id, support) =>
      `${lead}。請聯繫客服${support ? ` @${support}` : ""}辦理退款（訂單 #${id}）。`,
  },
  en: {
    kinds: {
      highlight: "highlight",
      category_pin: "category pin",
      pin: "site-wide pin",
      banner: "home banner",
      announcement: "announcement bar",
    },
    title: (kind, title) => `${kind} "${title}"`,
    entryStarted: (target, ends) =>
      `🎉 Your promotion (${target}) is live until ${ends}. The site updates in a few minutes.`,
    adStarted: (target, ends) => `🎉 Your ad (${target}) was approved and is live until ${ends}.`,
    refunded: (id) => `Order #${id} has been refunded to you.`,
    entryRefused: "Sorry, your promotion couldn't go live",
    adRefused: "Sorry, your ad was not approved",
    starsBack: (lead) => `${lead}. Your Stars were refunded.`,
    contact: (lead, id, support) =>
      `${lead}. Please contact support${support ? ` @${support}` : ""} for a refund (order #${id}).`,
  },
};

const utcTime = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export type OrderOutcome =
  /** Approved ad, or a pin started once a slot freed. */
  | { type: "started" }
  /** Rejected ad, or a waiting pin given up; refunded says whether the Stars went back already. */
  | { type: "rejected"; refunded: boolean }
  /** A rejected order refunded afterwards (a retried Stars refund, or one done by hand). */
  | { type: "refunded" };

function text(locale: SiteLocale, order: Order, outcome: OrderOutcome, support: string | null) {
  const w = words[locale];
  const entry = isEntryProduct(order.kind);
  const kind = w.kinds[order.kind];
  const target = order.targetUsername
    ? `${kind} @${order.targetUsername}`
    : w.title(kind, order.banner?.title ?? "");
  if (outcome.type === "started") {
    const ends = utcTime(order.endsAt ?? 0);
    return entry ? w.entryStarted(target, ends) : w.adStarted(target, ends);
  }
  if (outcome.type === "refunded") return w.refunded(order.id);
  const lead = entry ? w.entryRefused : w.adRefused;
  return outcome.refunded ? w.starsBack(lead) : w.contact(lead, order.id, support);
}

/** Tells the buyer, after the response. Best effort: the order's state is already recorded. */
export async function notifyBuyer(ctx: CoreContext, order: Order, outcome: OrderOutcome) {
  const token = ctx.config.BOT_TOKEN;
  if (!token) return;
  await background(ctx, async () => {
    const [locale, settings] = await Promise.all([
      getUserLocale(ctx.db, order.tgUserId),
      outcome.type === "rejected" && !outcome.refunded ? getSettings(ctx) : null,
    ]);
    const support = settings?.bot.supportUsername ?? null;
    const body = locale
      ? text(locale, order, outcome, support)
      : `${text("zh", order, outcome, support)}\n\n${text("en", order, outcome, support)}`;
    const res = await ctx.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: order.tgUserId, text: body }),
    });
    if (!res.ok) console.error("buyer notice failed", order.id, res.status);
  });
}
