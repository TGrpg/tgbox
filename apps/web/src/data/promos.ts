import type { Locale } from "@tgbox/shared";

/**
 * Sponsored slots on the home page. Phase 2 seeds house promos for our own pages; real ads replace
 * these in phase 3. Backgrounds are CSS (no external images). Keep this list empty-safe: the section
 * disappears when it has no items. Tailwind does not scan this folder — no utility classes here.
 */
export interface Promo {
  id: string;
  badge: Record<Locale, string>;
  title: Record<Locale, string>;
  subtitle: Record<Locale, string>;
  /** Site path (localized at render) or absolute URL. */
  href: string;
  icon: "robot" | "bottle" | "category" | "info" | "heart";
  /** CSS `background` value. */
  background: string;
}

export const promos: Promo[] = [
  {
    id: "enroll-bot",
    badge: { zh: "收录", en: "Submit" },
    title: { zh: "收录机器人", en: "Submit bot" },
    subtitle: { zh: "发送链接，几分钟内上线", en: "Send a link, live in minutes" },
    href: "/enroll/",
    icon: "robot",
    background:
      "radial-gradient(120% 90% at 100% 0%, #7dd3fc 0%, transparent 55%), linear-gradient(135deg, #1d8fe0 0%, #2563eb 60%, #1e3a8a 100%)",
  },
  {
    id: "random-bottle",
    badge: { zh: "推荐", en: "Pick" },
    title: { zh: "漂流瓶", en: "Drift bottle" },
    subtitle: { zh: "随机遇见一个好频道", en: "Stumble on a random gem" },
    href: "/random/",
    icon: "bottle",
    background:
      "radial-gradient(90% 80% at 0% 100%, #fde68a 0%, transparent 60%), linear-gradient(140deg, #fb923c 0%, #f43f5e 70%, #be123c 100%)",
  },
  {
    id: "browse-channels",
    badge: { zh: "分类", en: "Browse" },
    title: { zh: "按分类浏览", en: "Browse by category" },
    subtitle: { zh: "新闻、科技、影音、资源…", en: "News, tech, media and more" },
    href: "/channel/",
    icon: "category",
    background:
      "radial-gradient(100% 80% at 100% 100%, #a7f3d0 0%, transparent 55%), linear-gradient(135deg, #10b981 0%, #0d9488 55%, #115e59 100%)",
  },
  {
    id: "about",
    badge: { zh: "关于", en: "About" },
    title: { zh: "关于 TGbox", en: "About TGbox" },
    subtitle: { zh: "数据来源与收录规则", en: "Data sources and listing rules" },
    href: "/about/",
    icon: "info",
    background:
      "radial-gradient(110% 90% at 0% 0%, #c4b5fd 0%, transparent 55%), linear-gradient(150deg, #475569 0%, #1e293b 60%, #0f172a 100%)",
  },
  {
    id: "donate",
    badge: { zh: "支持", en: "Support" },
    title: { zh: "请我们喝杯咖啡", en: "Buy us a coffee" },
    subtitle: { zh: "让导航持续免费更新", en: "Keep the directory free" },
    href: "/donate/",
    icon: "heart",
    background:
      "radial-gradient(100% 90% at 100% 0%, #fbcfe8 0%, transparent 55%), linear-gradient(135deg, #ec4899 0%, #d946ef 55%, #7e22ce 100%)",
  },
];
