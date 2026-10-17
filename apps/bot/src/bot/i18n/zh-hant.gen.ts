// Generated from zh.ts by `pnpm --filter @tgbox/hant gen:bot`. Edit zh.ts, then regenerate.
import type { Entry } from "@tgbox/db";
import { type EntryKind, isEntryProduct, type ProductKind } from "@tgbox/shared";

type SubmissionSummary = {
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

/** A price is null when its payment method is switched off, and then it isn't shown at all. */
type ProductLabel = {
  name: string;
  days: number;
  stars: number | null;
  usdt: string | null;
};

/** What a promotion shows: a promoted entry, or a brand ad's title. */
type PromotionTarget = {
  kind: ProductKind;
  username: string | null;
  bannerTitle: string | null;
};

type OrderSummary = PromotionTarget & {
  id: number;
  product: string;
  stars: number | null;
  usdt: string | null;
};

type FriendLinkSummary = {
  id: number;
  name: string;
  url: string;
  description: string;
  backlink: boolean;
  applicantId: number;
  applicantUsername: string | null;
};

type AdOrderSummary = {
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
const utcTime = (ms: number) =>
  `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Who the support topic belongs to (shown in the topic header). */
type SupportUser = {
  id: number;
  name: string;
  username: string | null;
  language: string | null;
};

type EntryStatusSummary = {
  entry: Entry;
  members: number | null;
  category: string;
  tags: string[];
};

const zhKinds = { channel: "頻道", group: "群組", bot: "機器人" };
const zhProductKinds: Record<ProductKind, string> = {
  highlight: "高亮",
  category_pin: "分類置頂",
  pin: "全站置頂",
  banner: "首頁橫幅",
  announcement: "頂部公告條",
};

const zhProductEffects: Record<ProductKind, string> = {
  highlight: "在所有列表裡用金色底和「推廣」角標突出顯示，位置不變。",
  category_pin: "在自己所在分類裡排第一位，含高亮效果。",
  pin: "首頁、總覽、分類頁和詳情頁的「發現更多」都排最前，含高亮效果。",
  banner: "首頁贊助區大卡片，並出現在每個詳情頁側欄，可帶配圖。需審核。",
  announcement: "全站每一頁頂部的一行文字鏈接，獨佔一個名額。需審核。",
};

const zhTarget = (t: PromotionTarget) =>
  t.username
    ? `${zhProductKinds[t.kind]} @${t.username}`
    : `${zhProductKinds[t.kind]}「${t.bannerTitle ?? ""}」`;

export const zhHant = {
  welcome:
    "歡迎使用 TGbox收錄機器人！\n\n直接發送頻道、群組或機器人的鏈接（https://t.me/xxx、t.me/xxx 或 @xxx）即可提交收錄。",
  submitButton: "提交收錄",
  promoteButton: "購買推廣",
  submissionsClosed: "收錄暫時關閉，請稍後再來。",
  support: (username: string | null) =>
    username ? `客服聯繫方式：@${username}` : "暫未設置客服，請稍後再試。",
  help: "收錄標準：公開的頻道、群組或機器人，內容合法、持續更新、無刷粉。\n\n提交方式：發送 t.me 鏈接或 @用戶名，按提示選擇分類和標籤。\n審核結果會通過私信通知。\n\n/lang 切換語言，/support 聯繫客服。",
  menuButtonApp: "打開 TGbox",
  menuButtonAdmin: "管理後臺",
  openApp: "📱 在 App 中打開",
  openAppMy: "📱 查看我的提交",
  langButton: "🌐 語言 / Language",
  /** Telegram's command menu (`setMyCommands`); one source of truth for the bot and the deploy script. */
  commands: {
    submit: "提交收錄",
    promote: "購買推廣",
    support: "聯繫客服",
    lang: "切換語言 / Language",
    help: "使用幫助",
  },
  lang: {
    choose: "請選擇機器人語言：",
    // Each language named in its own script, like the website's switcher.
    zh: "簡體中文",
    zhHant: "繁體中文",
    en: "English",
    auto: "自動 / Auto",
    saved: "✅ 已切換到中文。",
    savedAuto: "✅ 已改為跟隨 Telegram 客戶端的語言。",
  },
  supportChat: {
    /** /support while the relay is on. */
    ask: "有任何問題，直接在這裡發消息就好，客服會盡快回復。",
    sent: "✅ 已轉達客服，請稍候。",
    unavailable: "客服暫時無法接收消息，請稍後再試。",
  },
  friendLink: {
    askUrl: (siteUrl: string) =>
      [
        "🤝 申請友情鏈接",
        "",
        "條件：網站可正常訪問、內容合法並持續更新，且已在你的網站上添加本站鏈接：",
        siteUrl,
        "",
        "第 1 步（共 3 步）：請發送你的網站地址（https:// 開頭）。",
      ].join("\n"),
    invalidUrl: "網址無效，請發送以 https:// 開頭的完整地址。",
    askName: "第 2 步：網站名稱（40 字以內）。",
    invalidName: "名稱需要 1–40 個字，請重新發送。",
    askDescription: "第 3 步：一句話介紹你的網站（120 字以內）。",
    invalidDescription: "簡介需要 1–120 個字，請重新發送。",
    submitted: (backlink: boolean): string =>
      backlink
        ? "✅ 申請已提交，審核結果會私信通知你。"
        : "✅ 申請已提交，審核結果會私信通知你。\n\n⚠️ 暫未在你的網站首頁找到本站鏈接，添加後通過率更高。",
    listed: "這個網站已經在友情鏈接裡了。",
    pending: "你已有一個友鏈申請在審核中，請等待結果。",
    cancelled: "已取消友鏈申請。",
  },
  sendLink: "請發送要提交的頻道、群組或機器人鏈接（https://t.me/xxx、t.me/xxx 或 @xxx）。",
  invalidLink:
    "無法識別鏈接。請發送 https://t.me/xxx、t.me/xxx 或 @xxx 格式的公開用戶名（邀請鏈接不支持）。",
  /** Bilingual on purpose: shown before a message that looked like a link is relayed to support. */
  maybeSubmission: "想收錄這個鏈接？請用 /submit 提交。 / To submit a link, use /submit.",
  alreadyListed: (username: string) => `@${username} 已經收錄，無需重複提交。`,
  alreadyPending: (username: string) => `@${username} 已在審核中，請耐心等待。`,
  dailyLimit: (limit: number) => `今天的提交次數已達上限（${limit} 次），請明天再試。`,
  notFound: (username: string) => `@${username} 不存在，請檢查用戶名。`,
  banned: (username: string) => `@${username} 已被 Telegram 封禁或限制，無法收錄。`,
  checking: (username: string) => `正在檢查 @${username}…`,
  unavailable: "暫時無法獲取資料，請稍後再試。",
  userAccount: (username: string) => `@${username} 是個人賬號，只能收錄公開的頻道、群組和機器人。`,
  kinds: zhKinds,
  members: "成員",
  profile: (kind: string, title: string, username: string) => `${kind}：${title}（@${username}）`,
  chooseCategory: "請選擇分類：",
  /** ✨ marks a guess made from the fetched title and description; the user still chooses. */
  chooseCategorySuggested: "請選擇分類（✨ 是根據簡介猜的，可以改）：",
  chooseTags: (count: number, max: number) => `請選擇標籤（可選，已選 ${count}/${max}）：`,
  tagsDone: "完成",
  prevPage: "« 上一頁",
  nextPage: "下一頁 »",
  confirmTitle: "請確認提交信息：",
  category: "分類",
  tags: "標籤",
  none: "無",
  confirm: "✅ 確認提交",
  editCategory: "修改分類",
  editTags: "修改標籤",
  cancel: "取消",
  cancelled: "已取消。隨時發送鏈接重新開始。",
  expired: "按鈕已過期，請重新發送鏈接開始。",
  submitted: "已提交，等待審核。審核結果會私信通知你。",
  noPermission: "沒有權限。",
  alreadyHandled: "已被處理。",
  approvedNotice: (username: string) =>
    `🎉 你提交的 @${username} 已通過審核並收錄，網站幾分鐘後更新。`,
  rejectedNotice: (username: string, reason: string) =>
    `很抱歉，你提交的 @${username} 未通過審核。原因：${reason}`,
  openTelegram: "打開 Telegram",
  openSite: "網站詳情",
  promote: {
    intro: (advertiseUrl: string) =>
      [
        "📣 購買推廣",
        "",
        "先選擇廣告位，下一步再選時長和價格。",
        "🔸 推廣我的條目：已收錄的頻道、群組、機器人，付款後立即生效",
        "🖼 品牌廣告：任意鏈接，審核通過後上線",
        "",
        `每種廣告位的效果示意：${advertiseUrl}`,
      ].join("\n"),
    placement: (kind: ProductKind) =>
      `${isEntryProduct(kind) ? "🔸" : "🖼"} ${zhProductKinds[kind]}`,
    chooseDuration: (kind: ProductKind) =>
      [`${zhProductKinds[kind]}`, zhProductEffects[kind], "", "請選擇時長："].join("\n"),
    back: "← 返回廣告位",
    unavailable: "暫時無法購買推廣，請稍後再試或聯繫客服（/support）。",
    product: (p: ProductLabel) =>
      `${p.name} · ${[p.stars === null ? "" : `⭐${p.stars}`, p.usdt === null ? "" : `${p.usdt} USDT`].filter(Boolean).join(" / ")}`,
    askTarget: "請發送要推廣的頻道、群組或機器人（@用戶名或 t.me 鏈接），必須是已收錄的條目。",
    askTitle: "請發送廣告標題（1–20 字）：",
    askSubtitle: "請發送廣告副標題（1–40 字）：",
    askHref: "請發送廣告鏈接（https:// 開頭，可以是 t.me 鏈接）：",
    askImage: "可選：發送一張橫幅圖片（jpg/png/webp，1MB 以內），或發送 /skip 跳過。",
    invalidTarget: "無法識別，請發送 @用戶名或 t.me 鏈接。",
    targetNotListed: (username: string) =>
      `@${username} 還沒有被收錄，只能推廣已收錄的條目。可以先發送 /submit 提交收錄。`,
    invalidTitle: "標題需要 1–20 個字，請重新發送。",
    invalidSubtitle: "副標題需要 1–40 個字，請重新發送。",
    invalidHref: "鏈接需要以 https:// 開頭，請重新發送。",
    invalidImage: "只支持 jpg/png/webp 圖片，且不超過 1MB。請重新發送，或 /skip 跳過。",
    imageFailed: "圖片上傳失敗，本次橫幅將不帶圖片。",
    noSlots: (nextFreeAt: number | null) =>
      nextFreeAt
        ? `名額已滿，最早 ${utcDate(nextFreeAt)} 有空位，屆時再來吧。`
        : "名額已滿，請稍後再試。",
    productUnavailable: "該商品已下架，請發送 /promote 重新選擇。",
    order: (o: OrderSummary) =>
      [
        `訂單 #${o.id}`,
        `商品：${o.product}`,
        `內容：${zhTarget(o)}`,
        `價格：${[o.stars === null ? "" : `⭐${o.stars}`, o.usdt === null ? "" : `${o.usdt} USDT`].filter(Boolean).join(" 或 ")}`,
      ].join("\n"),
    choosePayment: "請選擇支付方式：",
    noPaymentMethod: "暫時無法在線支付，請聯繫客服（/support）。",
    payStars: (stars: number) => `⭐ Telegram Stars（${stars}）`,
    payUsdt: (usdt: string) => `💵 USDT（${usdt}）`,
    payUsdtSelf: (usdt: string) => `💵 USDT·TRC20（${usdt}）`,
    usdtTransfer: (o: { address: string; amount: string; minutes: number }) =>
      [
        "💵 <b>USDT（TRC20）轉賬</b>",
        "",
        "收款地址（點擊複製）：",
        `<code>${o.address}</code>`,
        "",
        "轉賬金額（點擊複製）：",
        `<code>${o.amount}</code>`,
        "",
        `⚠️ <b>必須精確到這個金額</b>，末尾幾位小數是你這筆訂單的編號。多付或少付都無法自動確認，需要聯繫客服人工處理。`,
        "",
        `請在 ${o.minutes} 分鐘內完成轉賬，到賬後約 5 分鐘內自動確認並通知你。`,
      ].join("\n"),
    usdtNoAmount: "當前下單的人較多，請過一會兒再試。",
    orderExpired: "訂單已失效，請發送 /promote 重新下單。",
    invoiceDescription: (t: PromotionTarget, days: number) => `${zhTarget(t)}，${days} 天`,
    usdtInvoice: (amount: string) => `請在 1 小時內支付 ${amount} USDT，支付成功後會自動通知你。`,
    payNow: "去支付",
    invoiceFailed: "創建賬單失敗，請稍後再試。",
    cancelled: "已取消。",
    checkoutInvalid: "訂單已失效，請重新下單。",
    checkoutNoSlots: "名額已滿，本次不會扣款。",
    paidEntry: (t: PromotionTarget, days: number) =>
      `✅ 支付成功！${zhTarget(t)} 已上線 ${days} 天，網站幾分鐘後更新。`,
    paidAd: "✅ 支付成功！廣告已提交審核，通過後會通知你。",
    adApproved: (t: PromotionTarget, endsAt: number) =>
      `🎉 你的廣告（${zhTarget(t)}）已通過審核並上線，展示至 ${utcTime(endsAt)}。`,
    adRejectedRefunded: "很抱歉，你的廣告未通過審核，Stars 已原路退回。",
    adRejectedManual: (orderId: number, support: string | null) =>
      `很抱歉，你的廣告未通過審核。請聯繫客服${support ? ` @${support}` : ""}辦理退款（訂單 #${orderId}）。`,
    orphanRefunded: "該訂單已失效，本次支付的 Stars 已原路退回。",
    expired: (t: PromotionTarget) =>
      `你的推廣（${zhTarget(t)}）已到期下架。發送 /promote 可以再次購買。`,
    expiringSoon: (t: PromotionTarget, endsAt: number) =>
      `你的推廣（${zhTarget(t)}）將於 ${utcTime(endsAt)} 到期。發送 /promote 續費。`,
  },
  admin: {
    newSubmission: (s: SubmissionSummary) =>
      [
        "📥 新提交",
        `${zhKinds[s.kind]}：${s.title}`,
        `https://t.me/${s.username}`,
        `成員：${s.members ?? "未知"}`,
        `分類：${s.category}`,
        `標籤：${s.tags.length ? s.tags.join("、") : "無"}`,
        `提交人：${s.submitter}${s.submitterUsername ? ` @${s.submitterUsername}` : ""}（${s.submitterId}）`,
        "",
        s.description.slice(0, 500),
      ].join("\n"),
    approve: "✅ 通過",
    reject: "❌ 拒絕",
    back: "« 返回",
    approvedBy: (name: string) => `✅ 已通過（${name}）`,
    rejectedBy: (name: string, reason: string) => `❌ 已拒絕（${name}）：${reason}`,
    reasons: {
      content: "內容違規",
      grey: "灰黑產",
      fake_subs: "殭屍粉",
      inactive: "長期停更",
      duplicate: "重複",
      other: "其他",
    },
    reviewChatSet: "✅ 已把本群設為審核群。",
    support: {
      topicName: (name: string, userId: number) => `${name} (${userId})`,
      header: (u: SupportUser) =>
        [
          `👤 ${u.name}`,
          `ID：${u.id}`,
          `用戶名：${u.username ? `@${u.username}` : "無"}`,
          `語言：${u.language ?? "未知"}`,
          "",
          "在本話題內回覆即可轉發給用戶。/ban [原因] 拉黑，/done 結束會話。",
        ].join("\n"),
      banned: (userId: number, reason: string | null) =>
        `已拉黑用戶 ${userId}${reason ? `（${reason}）` : ""}，之後的消息不再轉發。`,
      done: "✅ 已結束本次會話。用戶再次發消息會自動重新打開。",
      relayFailed: (reason: string) =>
        `⚠️ 客服轉發失敗：${reason}\n請確認客服群已開啟「話題」，且機器人是管理員並有「管理話題」權限。`,
    },
    adReview: (o: AdOrderSummary) =>
      [
        "🖼 廣告待審核",
        `訂單 #${o.id}：${o.product}`,
        `標題：${o.title}`,
        `副標題：${o.subtitle}`,
        `鏈接：${o.href}`,
        ...(o.imageUrl ? [`圖片：${o.imageUrl}`] : []),
        `支付：${o.amount} ${o.currency}`,
        `買家：${o.buyerId}`,
      ].join("\n"),
    friendLinkReview: (f: FriendLinkSummary) =>
      [
        "🤝 友鏈申請待審核",
        `#${f.id} ${f.name}`,
        f.url,
        `簡介：${f.description}`,
        `回鏈：${f.backlink ? "✅ 首頁已有本站鏈接" : "❌ 首頁未找到本站鏈接"}`,
        `申請人：${f.applicantUsername ? `@${f.applicantUsername} ` : ""}${f.applicantId}`,
      ].join("\n"),
    friendLinkRejectedBy: (name: string) => `❌ 已拒絕（${name}）`,
    friendLinksFull: "友鏈已滿（30 個），請先在後臺刪除一些。",
    adRejected: (name: string, refunded: boolean, amount: string) =>
      `❌ 已拒絕（${name}）${refunded ? "，已自動退款" : `，需人工退款 ${amount}`}`,
    orphanPayment: (orderId: number, provider: string, chargeId: string, amount: string) =>
      `⚠️ 收到無效訂單 #${orderId} 的付款（${provider} ${chargeId}，${amount}），請人工核對並退款。`,
    banUsage: "用法：/ban <用戶ID|@用戶名> [原因]",
    unbanUsage: "用法：/unban <用戶ID|@用戶名>",
    banned: (target: string) => `已拉黑 ${target}`,
    unbanned: (target: string) => `已解除拉黑 ${target}`,
    notBanned: (target: string) => `${target} 不在黑名單中`,
    entryUsage: (command: string) => `用法：/${command} @用戶名`,
    setcatUsage: "用法：/setcat @用戶名 <分類slug>",
    settagsUsage: "用法：/settags @用戶名 tag1,tag2",
    entryNotFound: (username: string) => `未找到條目 @${username}`,
    statusSet: (username: string, status: string, changed: boolean) =>
      changed ? `@${username} 狀態已改為 ${status}` : `@${username} 狀態已是 ${status}`,
    unknownCategory: (slug: string, kind: string) => `分類 "${slug}" 不存在（類型 ${kind}）`,
    categorySet: (username: string, slug: string, changed: boolean) =>
      changed ? `@${username} 分類已改為 ${slug}` : `@${username} 分類未變化`,
    unknownTags: (slugs: string[]) => `未知標籤：${slugs.join(", ")}`,
    tooManyTags: (max: number) => `最多 ${max} 個標籤`,
    tagsSet: (username: string, slugs: string[], changed: boolean) =>
      changed ? `@${username} 標籤已改為 ${slugs.join(", ") || "無"}` : `@${username} 標籤未變化`,
    status: (s: EntryStatusSummary) =>
      [
        `@${s.entry.username}（${s.entry.kind}）${s.entry.title}`,
        `狀態：${s.entry.status}`,
        `檢測：${s.entry.liveness}，連續失敗 ${s.entry.failCount} 次${s.entry.lastFailAt ? `，最近失敗 ${new Date(s.entry.lastFailAt).toISOString()}` : ""}`,
        `成員：${s.members ?? "未知"}`,
        `分類：${s.category}`,
        `標籤：${s.tags.join(", ") || "無"}`,
        `收錄於：${new Date(s.entry.listedAt).toISOString()}`,
      ].join("\n"),
  },
};

/** Traditional names of the seed categories and tags, keyed by their Simplified names. */
export const hantNames: Record<string, string> = {
  "AI智能体": "AI智能體",
  "AI视频": "AI視頻",
  "AI绘画": "AI繪畫",
  "AI编程": "AI編程",
  "API中转": "API中轉",
  "iOS社区": "iOS社區",
  "TON生态": "TON生態",
  "主机VPS": "主機VPS",
  "书报刊漫": "書報刊漫",
  "交易市场": "交易市場",
  "交易机器人": "交易機器人",
  "体育": "體育",
  "免费": "免費",
  "免费API": "免費API",
  "兴趣社群": "興趣社群",
  "剧集": "劇集",
  "加密货币": "加密貨幣",
  "加密钱包": "加密錢包",
  "动漫": "動漫",
  "博客杂谈": "博客雜談",
  "同城地区": "同城地區",
  "商品优惠": "商品優惠",
  "壁纸图片": "壁紙圖片",
  "学习考试": "學習考試",
  "实用工具": "實用工具",
  "导航索引": "導航索引",
  "开发编程": "開發編程",
  "开源": "開源",
  "影音下载": "影音下載",
  "影音资源": "影音資源",
  "技术开发": "技術開發",
  "抽奖机器人": "抽獎機器人",
  "抽奖福利": "抽獎福利",
  "招聘求职": "招聘求職",
  "提示词": "提示詞",
  "摄影": "攝影",
  "数据分析": "數據分析",
  "数码硬件": "數碼硬件",
  "文件网盘": "文件網盤",
  "每日早报": "每日早報",
  "消息收发": "消息收發",
  "游戏": "遊戲",
  "游戏娱乐": "遊戲娛樂",
  "电子书": "電子書",
  "电影": "電影",
  "知识学习": "知識學習",
  "短剧": "短劇",
  "科学": "科學",
  "科学上网": "科學上網",
  "编程": "編程",
  "网盘": "網盤",
  "网盘资源": "網盤資源",
  "网络安全": "網絡安全",
  "群组管理": "群組管理",
  "翻译": "翻譯",
  "表情贴纸": "表情貼紙",
  "订阅推送": "訂閱推送",
  "设计": "設計",
  "财经": "財經",
  "资源分享": "資源分享",
  "资讯新闻": "資訊新聞",
  "软件社群": "軟件社群",
  "软件综合": "軟件綜合",
  "链上数据": "鏈上數據",
  "音乐": "音樂",
  "频道运营": "頻道運營"
};
