import { hashText } from "@/lib/announcement.ts";
import { promoBackgrounds } from "@/lib/promos.ts";

/** The card the site renders for a paid banner: the purchase preview and the ads in Browse. */
export function BannerCard({
  title,
  subtitle,
  imageUrl,
  seed,
  adLabel,
}: {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  seed: string;
  adLabel: string;
}) {
  const gradient =
    promoBackgrounds[Number.parseInt(hashText(seed), 36) % promoBackgrounds.length] ?? "";
  const background = imageUrl ? `url("${imageUrl}") center/cover no-repeat, ${gradient}` : gradient;
  return (
    <div
      className="relative flex aspect-[16/10] flex-col justify-end overflow-hidden rounded-2xl p-4 text-white"
      style={{ background }}
    >
      <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      <span className="absolute top-3 left-3 rounded-md bg-black/30 px-1.5 py-0.5 font-semibold text-[0.7rem]">
        {adLabel}
      </span>
      <span className="relative line-clamp-2 font-bold text-lg leading-tight" dir="auto">
        {title}
      </span>
      <span className="relative mt-0.5 truncate text-[0.8rem] text-white/85" dir="auto">
        {subtitle}
      </span>
    </div>
  );
}
