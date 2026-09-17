import type { CategoryIcon } from "@tgbox/shared";
import {
  AppleIcon,
  AppWindowIcon,
  BadgePercentIcon,
  BookIcon,
  BriefcaseIcon,
  ChartLineIcon,
  CloudIcon,
  CodeIcon,
  CoffeeIcon,
  CoinsIcon,
  CompassIcon,
  DownloadIcon,
  EllipsisIcon,
  FileTextIcon,
  FilmIcon,
  FolderIcon,
  Gamepad2Icon,
  GiftIcon,
  GlobeIcon,
  GraduationCapIcon,
  HeartIcon,
  ImageIcon,
  type LucideIcon,
  MapPinIcon,
  MessageCircleIcon,
  NewspaperIcon,
  SearchIcon,
  SendIcon,
  ServerIcon,
  ShapesIcon,
  Share2Icon,
  ShieldIcon,
  SmileIcon,
  SparklesIcon,
  StickerIcon,
  StoreIcon,
  WrenchIcon,
} from "lucide-react";

// Admin preview only: the site renders the Tabler icon with the same key.
const icons: Record<CategoryIcon, LucideIcon> = {
  news: NewspaperIcon,
  movie: FilmIcon,
  apps: AppWindowIcon,
  share: Share2Icon,
  school: GraduationCapIcon,
  "mood-happy": SmileIcon,
  book: BookIcon,
  article: FileTextIcon,
  photo: ImageIcon,
  code: CodeIcon,
  sparkles: SparklesIcon,
  discount: BadgePercentIcon,
  "device-gamepad-2": Gamepad2Icon,
  sticker: StickerIcon,
  compass: CompassIcon,
  "message-circle": MessageCircleIcon,
  heart: HeartIcon,
  server: ServerIcon,
  "brand-apple": AppleIcon,
  dots: EllipsisIcon,
  tool: WrenchIcon,
  send: SendIcon,
  shield: ShieldIcon,
  search: SearchIcon,
  download: DownloadIcon,
  gift: GiftIcon,
  coin: CoinsIcon,
  world: GlobeIcon,
  cloud: CloudIcon,
  briefcase: BriefcaseIcon,
  "map-pin": MapPinIcon,
  "building-store": StoreIcon,
  folder: FolderIcon,
  "chart-line": ChartLineIcon,
  coffee: CoffeeIcon,
  category: ShapesIcon,
};

function isIconKey(key: string): key is CategoryIcon {
  return Object.hasOwn(icons, key);
}

export function CategoryIconPreview({
  icon,
  className,
}: {
  icon: string | null;
  className?: string;
}) {
  const Icon = icon !== null && isIconKey(icon) ? icons[icon] : ShapesIcon;
  return <Icon className={className} aria-hidden />;
}
