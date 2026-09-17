import BookIcon from "@tabler/icons/outline/book.svg";
import HomeIcon from "@tabler/icons/outline/home.svg";
import InfoIcon from "@tabler/icons/outline/info-circle.svg";
import BotIcon from "@tabler/icons/outline/robot.svg";
import ChannelIcon from "@tabler/icons/outline/speakerphone.svg";
import TrophyIcon from "@tabler/icons/outline/trophy.svg";
import GroupIcon from "@tabler/icons/outline/users.svg";
import { type Locale, t } from "@tgbox/shared";
import { localizePath } from "@/i18n/locale.ts";
import { ui } from "@/i18n/ui.ts";

/**
 * Primary sections, shared by the desktop pill nav and the mobile tab bar. `secondary` items are
 * left out of the 5-slot mobile tab bar (the footer links them) and of the narrow desktop header.
 */
export function navItems(locale: Locale, path: string) {
  const neutralPath = localizePath(path, "zh");
  return [
    { href: "/", label: t(locale, "site.home"), icon: HomeIcon, secondary: false },
    { href: "/channel/", label: t(locale, "site.channels"), icon: ChannelIcon, secondary: false },
    { href: "/group/", label: t(locale, "site.groups"), icon: GroupIcon, secondary: false },
    { href: "/bot/", label: t(locale, "site.bots"), icon: BotIcon, secondary: false },
    { href: "/rank/", label: ui(locale).nav.rank, icon: TrophyIcon, secondary: false },
    { href: "/guides/", label: ui(locale).nav.guides, icon: BookIcon, secondary: true },
    { href: "/about/", label: ui(locale).nav.about, icon: InfoIcon, secondary: true },
  ].map((item) => ({
    ...item,
    href: localizePath(item.href, locale),
    active: item.href === "/" ? neutralPath === "/" : neutralPath.startsWith(item.href),
  }));
}
