import HomeIcon from "@tabler/icons/outline/home.svg";
import InfoIcon from "@tabler/icons/outline/info-circle.svg";
import BotIcon from "@tabler/icons/outline/robot.svg";
import ChannelIcon from "@tabler/icons/outline/speakerphone.svg";
import GroupIcon from "@tabler/icons/outline/users.svg";
import { type Locale, t } from "@tgbox/shared";
import { localizePath } from "@/i18n/locale.ts";
import { ui } from "@/i18n/ui.ts";

/** Primary sections, shared by the desktop pill nav and the mobile tab bar. */
export function navItems(locale: Locale, path: string) {
  const neutralPath = localizePath(path, "zh");
  return [
    { href: "/", label: t(locale, "site.home"), icon: HomeIcon },
    { href: "/channel/", label: t(locale, "site.channels"), icon: ChannelIcon },
    { href: "/group/", label: t(locale, "site.groups"), icon: GroupIcon },
    { href: "/bot/", label: t(locale, "site.bots"), icon: BotIcon },
    { href: "/about/", label: ui(locale).nav.about, icon: InfoIcon },
  ].map((item) => ({
    ...item,
    href: localizePath(item.href, locale),
    active: item.href === "/" ? neutralPath === "/" : neutralPath.startsWith(item.href),
  }));
}
