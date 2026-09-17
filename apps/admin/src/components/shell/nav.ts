import {
  BanIcon,
  ClipboardCheckIcon,
  LayoutDashboardIcon,
  ListIcon,
  type LucideIcon,
  PlusCircleIcon,
  RocketIcon,
  ScrollTextIcon,
  SettingsIcon,
  TagsIcon,
} from "lucide-react";

export type NavItem = {
  to:
    | "/"
    | "/review"
    | "/entries"
    | "/add"
    | "/taxonomy"
    | "/promotions"
    | "/blacklist"
    | "/audit"
    | "/settings";
  label: string;
  icon: LucideIcon;
  /** shown in the mobile bottom bar (the rest live under "更多") */
  primary: boolean;
};

export const navItems: NavItem[] = [
  { to: "/", label: "看板", icon: LayoutDashboardIcon, primary: true },
  { to: "/review", label: "审核", icon: ClipboardCheckIcon, primary: true },
  { to: "/entries", label: "条目", icon: ListIcon, primary: true },
  { to: "/add", label: "收录", icon: PlusCircleIcon, primary: true },
  { to: "/taxonomy", label: "分类标签", icon: TagsIcon, primary: false },
  { to: "/promotions", label: "推广", icon: RocketIcon, primary: false },
  { to: "/blacklist", label: "黑名单", icon: BanIcon, primary: false },
  { to: "/audit", label: "操作日志", icon: ScrollTextIcon, primary: false },
  { to: "/settings", label: "设置", icon: SettingsIcon, primary: false },
];
