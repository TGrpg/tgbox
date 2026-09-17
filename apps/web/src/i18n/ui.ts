import { type EntryKind, type Locale, t } from "@tgbox/shared";

/** Web-only UI strings. Shared strings (site.*) come from `t()` in @tgbox/shared. */
const zh = {
  nav: {
    about: "关于",
    primary: "主导航",
    skipToContent: "跳到正文",
    backToTop: "回到顶部",
  },
  search: {
    placeholder: "搜索频道、群组、机器人",
    short: "搜索…",
    shortcut: "Ctrl K",
    dialogLabel: "站内搜索",
    hot: "热门搜索",
    loading: "搜索中…",
    empty: "没有找到相关条目",
    error: "搜索暂时不可用",
    fallback: "用其他搜索引擎搜索本站",
    google: "Google",
    bing: "Bing",
  },
  random: {
    eyebrow: "Drift bottle",
    lead: "从收录的频道、群组和机器人里随机捞一个，说不定就遇到宝藏。",
    kinds: "类型",
    all: "全部",
    again: "再捞一个",
    open: "查看详情",
    loading: "正在打捞…",
    empty: "这里暂时还没有条目。",
    error: "加载失败，请稍后再试。",
  },
  go: {
    title: "正在前往 Telegram",
    lead: "正在测试哪个 Telegram 域名在你的网络下最快，稍后自动跳转。",
    invalid: "链接无效：缺少或不合法的用户名。",
    testing: "测速中…",
    timeout: "超时",
    redirecting: "即将跳转到 {host}…",
    failed: "所有域名都连不上，请手动选择或直接在 App 中打开。",
    openApp: "在 Telegram App 中打开",
    manual: "手动选择",
    fastest: "最快",
    cancel: "取消自动跳转",
    cancelled: "已取消自动跳转，请手动选择线路。",
    goNow: "立即前往",
  },
  share: {
    copy: "复制链接",
    copied: "已复制",
    telegram: "分享到 Telegram",
    qr: "扫码打开",
    close: "关闭",
  },
  theme: {
    toggle: "切换亮色/暗色主题",
  },
  lang: {
    switchTo: "English",
    switchLabel: "Switch to English",
  },
  announcement: {
    cta: "查看",
    badge: "公告",
    dismiss: "关闭公告",
  },
  footer: {
    sections: "导航分区",
    explore: "探索与提交",
    more: "更多信息",
    enroll: "提交收录说明",
    bot: "收录机器人",
    disclaimer:
      "本站仅收录公开的 Telegram 频道、群组和机器人，资料来自 Telegram 公开页面并定期自动更新。条目内容由其所有者负责，与本站无关；标有“推广”的条目为付费或合作展示。如发现违规内容或需要删除条目，请通过收录机器人联系我们。",
    rights: "保留所有权利。",
  },
  page: {
    enroll: "提交收录",
    about: "关于本站",
    privacy: "隐私政策",
    donate: "赞助支持",
    links: "友情链接",
    updated: "最后更新",
  },
  notFound: {
    eyebrow: "404",
    lead: "你访问的页面不存在，可能已经被移除，或者链接输错了。收录条目被封禁或失效后，对应页面也会下线。",
    home: "返回首页",
    search: "搜索条目",
  },
  entry: {
    kind: { channel: "频道", group: "群组", bot: "机器人" } satisfies Record<EntryKind, string>,
    members: { channel: "订阅", group: "成员", bot: "月活" } satisfies Record<EntryKind, string>,
    promoted: "推广",
    ad: "广告",
    verified: "已认证",
    noDescription: "暂无简介",
  },
  pagination: {
    label: "分页",
    previous: "上一页",
    next: "下一页",
    page: "第 {n} 页",
  },
  breadcrumbs: {
    label: "面包屑导航",
  },
  section: {
    more: "查看全部",
  },
  sidebar: {
    label: "分类导航",
    all: "全部",
    expand: "展开分类",
  },
  listing: {
    categories: "分类",
    top: "热门条目",
    count: "{n} 个条目",
    empty: "这里暂时还没有条目。",
    kindDescription: "按分类浏览本站收录的 Telegram {kind}，按成员数排序，数据定期自动更新。",
    categoryDescription:
      "Telegram {category}{kind}列表，共 {n} 个，按成员数排序，含成员数、简介和活跃度。",
    tag: "标签",
    tagDescription: "带有“{tag}”标签的 Telegram 频道、群组和机器人，共 {n} 个。",
  },
  detail: {
    join: "加入",
    openApp: "在 App 中打开",
    openWeb: "网页版 t.me",
    share: "分享",
    category: "分类",
    tags: "标签",
    lang: "语言",
    description: "简介",
    online: "在线",
    activity: "活跃度",
    activityTier: ["停更", "低", "一般", "活跃", "非常活跃"],
    tgCreated: "创建时间",
    listed: "收录时间",
    unknown: "未知",
    posts: "最近消息",
    viewMore: "在 t.me 查看更多消息",
    views: "{n} 次浏览",
    history: "成员趋势",
    relatedChannels: "相关频道",
    relatedGroups: "相关群组",
    metaDescription: "{title}（@{username}）是一个 Telegram {kind}，{members}。{description}",
  },
  meta: {
    description:
      "TGbox收录优质的 Telegram 中文频道、群组和机器人，提供精确成员数、活跃度、最近消息预览和分类标签，数据定期自动更新。",
  },
};

const en: typeof zh = {
  nav: {
    about: "About",
    primary: "Main navigation",
    skipToContent: "Skip to content",
    backToTop: "Back to top",
  },
  search: {
    placeholder: "Search channels, groups, bots",
    short: "Search…",
    shortcut: "Ctrl K",
    dialogLabel: "Site search",
    hot: "Popular searches",
    loading: "Searching…",
    empty: "No matching entries",
    error: "Search is unavailable right now",
    fallback: "Search this site with",
    google: "Google",
    bing: "Bing",
  },
  random: {
    eyebrow: "Drift bottle",
    lead: "Fish a random channel, group or bot out of the directory — you might find a gem.",
    kinds: "Type",
    all: "All",
    again: "Try another",
    open: "View details",
    loading: "Fishing…",
    empty: "Nothing listed here yet.",
    error: "Failed to load. Please try again later.",
  },
  go: {
    title: "Opening Telegram",
    lead: "Testing which Telegram domain is fastest on your network; you'll be redirected shortly.",
    invalid: "Invalid link: the username is missing or malformed.",
    testing: "Testing…",
    timeout: "Timed out",
    redirecting: "Redirecting to {host}…",
    failed: "No domain is reachable. Pick one manually or open the app directly.",
    openApp: "Open in the Telegram app",
    manual: "Choose manually",
    fastest: "Fastest",
    cancel: "Cancel redirect",
    cancelled: "Redirect cancelled. Pick a route below.",
    goNow: "Go now",
  },
  share: {
    copy: "Copy link",
    copied: "Copied",
    telegram: "Share to Telegram",
    qr: "Scan to open",
    close: "Close",
  },
  theme: {
    toggle: "Toggle light/dark theme",
  },
  lang: {
    switchTo: "中文",
    switchLabel: "切换到中文",
  },
  announcement: {
    cta: "View",
    badge: "Notice",
    dismiss: "Dismiss notice",
  },
  footer: {
    sections: "Browse",
    explore: "Explore & submit",
    more: "More",
    enroll: "Submission guide",
    bot: "Submission bot",
    disclaimer:
      "We only list public Telegram channels, groups and bots. Data comes from public Telegram pages and is refreshed automatically. Listed owners are responsible for their content; entries marked “Promoted” are paid or partner placements. To report abuse or request removal, contact us through the submission bot.",
    rights: "All rights reserved.",
  },
  page: {
    enroll: "Submit a listing",
    about: "About",
    privacy: "Privacy Policy",
    donate: "Support us",
    links: "Links",
    updated: "Last updated",
  },
  notFound: {
    eyebrow: "404",
    lead: "The page you are looking for doesn’t exist. It may have been removed, or the link is mistyped. Pages of banned or dead entries are taken down too.",
    home: "Back to home",
    search: "Search entries",
  },
  entry: {
    kind: { channel: "Channel", group: "Group", bot: "Bot" },
    members: { channel: "subscribers", group: "members", bot: "monthly users" },
    promoted: "Promoted",
    ad: "Ad",
    verified: "Verified",
    noDescription: "No description",
  },
  pagination: {
    label: "Pagination",
    previous: "Previous",
    next: "Next",
    page: "Page {n}",
  },
  breadcrumbs: {
    label: "Breadcrumb",
  },
  section: {
    more: "View all",
  },
  sidebar: {
    label: "Category navigation",
    all: "All",
    expand: "Expand categories",
  },
  listing: {
    categories: "Categories",
    top: "Top entries",
    count: "{n} entries",
    empty: "Nothing listed here yet.",
    kindDescription:
      "Browse Telegram {kind} by category, sorted by member count and refreshed automatically.",
    categoryDescription:
      "{n} Telegram {kind} in {category}, sorted by member count, with descriptions and activity levels.",
    tag: "Tag",
    tagDescription: "{n} Telegram channels, groups and bots tagged “{tag}”.",
  },
  detail: {
    join: "Join",
    openApp: "Open in app",
    openWeb: "Open t.me",
    share: "Share",
    category: "Category",
    tags: "Tags",
    lang: "Language",
    description: "About",
    online: "online",
    activity: "Activity",
    activityTier: ["Dormant", "Low", "Moderate", "Active", "Very active"],
    tgCreated: "Created",
    listed: "Listed",
    unknown: "Unknown",
    posts: "Recent posts",
    viewMore: "View more posts on t.me",
    views: "{n} views",
    history: "Member trend",
    relatedChannels: "Related channels",
    relatedGroups: "Related groups",
    metaDescription: "{title} (@{username}) is a Telegram {kind} with {members}. {description}",
  },
  meta: {
    description:
      "TGbox lists quality Telegram channels, groups and bots with exact member counts, activity levels, recent post previews and categories — refreshed automatically.",
  },
};

const dictionaries: Record<Locale, typeof zh> = { zh, en };

export function ui(locale: Locale) {
  return dictionaries[locale];
}

/** Plural section titles per kind ("频道" / "Channels"). */
export function kindTitles(locale: Locale): Record<EntryKind, string> {
  return {
    channel: t(locale, "site.channels"),
    group: t(locale, "site.groups"),
    bot: t(locale, "site.bots"),
  };
}
