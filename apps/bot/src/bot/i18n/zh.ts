import type { Entry } from "@tgbox/db";
import type { EntryKind } from "@tgbox/shared";

export type SubmissionSummary = {
  username: string;
  kind: EntryKind;
  title: string;
  description: string;
  members: number | null;
  category: string;
  tags: string[];
  submitter: string;
  submitterUsername: string | null;
  submitterId: number;
};

export type ProductLabel = { name: string; days: number; stars: number; usdt: string };

/** What a promotion shows: a pinned entry or a banner. */
export type PromotionTarget = { username: string | null; bannerTitle: string | null };

export type OrderSummary = PromotionTarget & {
  id: number;
  product: string;
  stars: number;
  usdt: string;
};

export type BannerOrderSummary = {
  id: number;
  product: string;
  title: string;
  subtitle: string;
  href: string;
  /** Absent on banners bought without an image. */
  imageUrl?: string | null;
  amount: string;
  currency: string;
  buyerId: number;
};

/** YYYY-MM-DD HH:mm in UTC */
export const utcTime = (ms: number) =>
  `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Who the support topic belongs to (shown in the topic header). */
export type SupportUser = {
  id: number;
  name: string;
  username: string | null;
  language: string | null;
};

export type EntryStatusSummary = {
  entry: Entry;
  members: number | null;
  category: string;
  tags: string[];
};

const zhKinds = { channel: "频道", group: "群组", bot: "机器人" };
const zhTarget = (t: PromotionTarget) =>
  t.username ? `置顶 @${t.username}` : `首页横幅「${t.bannerTitle ?? ""}」`;

export const zh = {
  welcome:
    "欢迎使用 TGbox收录机器人！\n\n直接发送频道、群组或机器人的链接（https://t.me/xxx、t.me/xxx 或 @xxx）即可提交收录。",
  submitButton: "提交收录",
  promoteButton: "购买推广",
  submissionsClosed: "收录暂时关闭，请稍后再来。",
  support: (username: string | null) =>
    username ? `客服联系方式：@${username}` : "暂未设置客服，请稍后再试。",
  help: "收录标准：公开的频道、群组或机器人，内容合法、持续更新、无刷粉。\n\n提交方式：发送 t.me 链接或 @用户名，按提示选择分类和标签。\n审核结果会通过私信通知。\n\n/lang 切换语言，/support 联系客服。",
  langButton: "🌐 语言 / Language",
  /** Telegram's command menu (`setMyCommands`); one source of truth for the bot and the deploy script. */
  commands: {
    submit: "提交收录",
    promote: "购买推广",
    support: "联系客服",
    lang: "切换语言 / Language",
    help: "使用帮助",
  },
  lang: {
    choose: "请选择机器人语言：",
    zh: "中文",
    en: "English",
    auto: "自动 / Auto",
    saved: "✅ 已切换到中文。",
    savedAuto: "✅ 已改为跟随 Telegram 客户端的语言。",
  },
  supportChat: {
    /** /support while the relay is on. */
    ask: "有任何问题，直接在这里发消息就好，客服会尽快回复。",
    sent: "✅ 已转达客服，请稍候。",
    unavailable: "客服暂时无法接收消息，请稍后再试。",
  },
  sendLink: "请发送要提交的频道、群组或机器人链接（https://t.me/xxx、t.me/xxx 或 @xxx）。",
  invalidLink:
    "无法识别链接。请发送 https://t.me/xxx、t.me/xxx 或 @xxx 格式的公开用户名（邀请链接不支持）。",
  /** Bilingual on purpose: shown before a message that looked like a link is relayed to support. */
  maybeSubmission: "想收录这个链接？请用 /submit 提交。 / To submit a link, use /submit.",
  alreadyListed: (username: string) => `@${username} 已经收录，无需重复提交。`,
  alreadyPending: (username: string) => `@${username} 已在审核中，请耐心等待。`,
  dailyLimit: (limit: number) => `今天的提交次数已达上限（${limit} 次），请明天再试。`,
  notFound: (username: string) => `@${username} 不存在，请检查用户名。`,
  banned: (username: string) => `@${username} 已被 Telegram 封禁或限制，无法收录。`,
  checking: (username: string) => `正在检查 @${username}…`,
  unavailable: "暂时无法获取资料，请稍后再试。",
  userAccount: (username: string) => `@${username} 是个人账号，只能收录公开的频道、群组和机器人。`,
  kinds: zhKinds,
  members: "成员",
  profile: (kind: string, title: string, username: string) => `${kind}：${title}（@${username}）`,
  chooseCategory: "请选择分类：",
  chooseTags: (count: number, max: number) => `请选择标签（可选，已选 ${count}/${max}）：`,
  tagsDone: "完成",
  prevPage: "« 上一页",
  nextPage: "下一页 »",
  confirmTitle: "请确认提交信息：",
  category: "分类",
  tags: "标签",
  none: "无",
  confirm: "✅ 确认提交",
  editCategory: "修改分类",
  editTags: "修改标签",
  cancel: "取消",
  cancelled: "已取消。随时发送链接重新开始。",
  expired: "按钮已过期，请重新发送链接开始。",
  submitted: "已提交，等待审核。审核结果会私信通知你。",
  noPermission: "没有权限。",
  alreadyHandled: "已被处理。",
  approvedNotice: (username: string) =>
    `🎉 你提交的 @${username} 已通过审核并收录，网站几分钟后更新。`,
  rejectedNotice: (username: string, reason: string) =>
    `很抱歉，你提交的 @${username} 未通过审核。原因：${reason}`,
  openTelegram: "打开 Telegram",
  openSite: "网站详情",
  promote: {
    intro:
      "📣 推广位\n\n置顶：已收录的条目在网站列表中置顶展示。\n首页横幅：网站首页的推广卡片（需审核）。\n\n请选择商品：",
    unavailable: "暂时无法购买推广，请稍后再试或联系客服（/support）。",
    product: (p: ProductLabel) => `${p.name} · ⭐${p.stars} / ${p.usdt} USDT`,
    askTarget: "请发送要置顶的频道、群组或机器人（@用户名或 t.me 链接），必须是已收录的条目。",
    askTitle: "请发送横幅标题（1–20 字）：",
    askSubtitle: "请发送横幅副标题（1–40 字）：",
    askHref: "请发送横幅链接（https:// 开头，可以是 t.me 链接）：",
    askImage: "可选：发送一张横幅图片（jpg/png/webp，1MB 以内），或发送 /skip 跳过。",
    invalidTarget: "无法识别，请发送 @用户名或 t.me 链接。",
    targetNotListed: (username: string) =>
      `@${username} 还没有被收录，只能置顶已收录的条目。可以先发送 /submit 提交收录。`,
    invalidTitle: "标题需要 1–20 个字，请重新发送。",
    invalidSubtitle: "副标题需要 1–40 个字，请重新发送。",
    invalidHref: "链接需要以 https:// 开头，请重新发送。",
    invalidImage: "只支持 jpg/png/webp 图片，且不超过 1MB。请重新发送，或 /skip 跳过。",
    imageFailed: "图片上传失败，本次横幅将不带图片。",
    noSlots: (nextFreeAt: number | null) =>
      nextFreeAt
        ? `名额已满，最早 ${utcDate(nextFreeAt)} 有空位，届时再来吧。`
        : "名额已满，请稍后再试。",
    productUnavailable: "该商品已下架，请发送 /promote 重新选择。",
    order: (o: OrderSummary) =>
      [
        `订单 #${o.id}`,
        `商品：${o.product}`,
        `内容：${zhTarget(o)}`,
        `价格：⭐${o.stars} 或 ${o.usdt} USDT`,
      ].join("\n"),
    choosePayment: "请选择支付方式：",
    noPaymentMethod: "暂时无法在线支付，请联系客服（/support）。",
    payStars: (stars: number) => `⭐ Telegram Stars（${stars}）`,
    payUsdt: (usdt: string) => `💵 USDT（${usdt}）`,
    orderExpired: "订单已失效，请发送 /promote 重新下单。",
    invoiceDescription: (t: PromotionTarget, days: number) => `${zhTarget(t)}，${days} 天`,
    usdtInvoice: (amount: string) => `请在 1 小时内支付 ${amount} USDT，支付成功后会自动通知你。`,
    payNow: "去支付",
    invoiceFailed: "创建账单失败，请稍后再试。",
    cancelled: "已取消。",
    checkoutInvalid: "订单已失效，请重新下单。",
    checkoutNoSlots: "名额已满，本次不会扣款。",
    paidPin: (username: string, days: number) =>
      `✅ 支付成功！@${username} 已置顶 ${days} 天，网站几分钟后更新。`,
    paidBanner: "✅ 支付成功！横幅已提交审核，通过后会通知你。",
    bannerApproved: (endsAt: number) =>
      `🎉 你的首页横幅已通过审核并上线，展示至 ${utcTime(endsAt)}。`,
    bannerRejectedRefunded: "很抱歉，你的首页横幅未通过审核，Stars 已原路退回。",
    bannerRejectedManual: (orderId: number, support: string | null) =>
      `很抱歉，你的首页横幅未通过审核。请联系客服${support ? ` @${support}` : ""}办理退款（订单 #${orderId}）。`,
    orphanRefunded: "该订单已失效，本次支付的 Stars 已原路退回。",
    expired: (t: PromotionTarget) =>
      `你的推广（${zhTarget(t)}）已到期下架。发送 /promote 可以再次购买。`,
    expiringSoon: (t: PromotionTarget, endsAt: number) =>
      `你的推广（${zhTarget(t)}）将于 ${utcTime(endsAt)} 到期。发送 /promote 续费。`,
  },
  admin: {
    newSubmission: (s: SubmissionSummary) =>
      [
        "📥 新提交",
        `${zhKinds[s.kind]}：${s.title}`,
        `https://t.me/${s.username}`,
        `成员：${s.members ?? "未知"}`,
        `分类：${s.category}`,
        `标签：${s.tags.length ? s.tags.join("、") : "无"}`,
        `提交人：${s.submitter}${s.submitterUsername ? ` @${s.submitterUsername}` : ""}（${s.submitterId}）`,
        "",
        s.description.slice(0, 500),
      ].join("\n"),
    approve: "✅ 通过",
    reject: "❌ 拒绝",
    back: "« 返回",
    approvedBy: (name: string) => `✅ 已通过（${name}）`,
    rejectedBy: (name: string, reason: string) => `❌ 已拒绝（${name}）：${reason}`,
    reasons: {
      content: "内容违规",
      grey: "灰黑产",
      fake_subs: "僵尸粉",
      inactive: "长期停更",
      duplicate: "重复",
      other: "其他",
    },
    reviewChatSet: "✅ 已把本群设为审核群。",
    support: {
      topicName: (name: string, userId: number) => `${name} (${userId})`,
      header: (u: SupportUser) =>
        [
          `👤 ${u.name}`,
          `ID：${u.id}`,
          `用户名：${u.username ? `@${u.username}` : "无"}`,
          `语言：${u.language ?? "未知"}`,
          "",
          "在本话题内回复即可转发给用户。/ban [原因] 拉黑，/done 结束会话。",
        ].join("\n"),
      banned: (userId: number, reason: string | null) =>
        `已拉黑用户 ${userId}${reason ? `（${reason}）` : ""}，之后的消息不再转发。`,
      done: "✅ 已结束本次会话。用户再次发消息会自动重新打开。",
      relayFailed: (reason: string) =>
        `⚠️ 客服转发失败：${reason}\n请确认客服群已开启「话题」，且机器人是管理员并有「管理话题」权限。`,
    },
    bannerReview: (o: BannerOrderSummary) =>
      [
        "🖼 首页横幅待审核",
        `订单 #${o.id}：${o.product}`,
        `标题：${o.title}`,
        `副标题：${o.subtitle}`,
        `链接：${o.href}`,
        ...(o.imageUrl ? [`图片：${o.imageUrl}`] : []),
        `支付：${o.amount} ${o.currency}`,
        `买家：${o.buyerId}`,
      ].join("\n"),
    bannerRejected: (name: string, refunded: boolean, amount: string) =>
      `❌ 已拒绝（${name}）${refunded ? "，已自动退款" : `，需人工退款 ${amount}`}`,
    orphanPayment: (orderId: number, provider: string, chargeId: string, amount: string) =>
      `⚠️ 收到无效订单 #${orderId} 的付款（${provider} ${chargeId}，${amount}），请人工核对并退款。`,
    banUsage: "用法：/ban <用户ID|@用户名> [原因]",
    unbanUsage: "用法：/unban <用户ID|@用户名>",
    banned: (target: string) => `已拉黑 ${target}`,
    unbanned: (target: string) => `已解除拉黑 ${target}`,
    notBanned: (target: string) => `${target} 不在黑名单中`,
    entryUsage: (command: string) => `用法：/${command} @用户名`,
    setcatUsage: "用法：/setcat @用户名 <分类slug>",
    settagsUsage: "用法：/settags @用户名 tag1,tag2",
    entryNotFound: (username: string) => `未找到条目 @${username}`,
    statusSet: (username: string, status: string, changed: boolean) =>
      changed ? `@${username} 状态已改为 ${status}` : `@${username} 状态已是 ${status}`,
    unknownCategory: (slug: string, kind: string) => `分类 "${slug}" 不存在（类型 ${kind}）`,
    categorySet: (username: string, slug: string, changed: boolean) =>
      changed ? `@${username} 分类已改为 ${slug}` : `@${username} 分类未变化`,
    unknownTags: (slugs: string[]) => `未知标签：${slugs.join(", ")}`,
    tooManyTags: (max: number) => `最多 ${max} 个标签`,
    tagsSet: (username: string, slugs: string[], changed: boolean) =>
      changed ? `@${username} 标签已改为 ${slugs.join(", ") || "无"}` : `@${username} 标签未变化`,
    status: (s: EntryStatusSummary) =>
      [
        `@${s.entry.username}（${s.entry.kind}）${s.entry.title}`,
        `状态：${s.entry.status}`,
        `检测：${s.entry.liveness}，连续失败 ${s.entry.failCount} 次${s.entry.lastFailAt ? `，最近失败 ${new Date(s.entry.lastFailAt).toISOString()}` : ""}`,
        `成员：${s.members ?? "未知"}`,
        `分类：${s.category}`,
        `标签：${s.tags.join(", ") || "无"}`,
        `收录于：${new Date(s.entry.listedAt).toISOString()}`,
      ].join("\n"),
  },
};
