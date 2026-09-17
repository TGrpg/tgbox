import { useQuery } from "@tanstack/react-query";
import type { PromotionClicks } from "@tgbox/core";
import { MousePointerClickIcon } from "lucide-react";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { type ClickPoint, clickHistoryQueryOptions } from "@/functions/promotions.ts";
import { RECENT_LABEL, shortDay } from "./labels.ts";

const zh = (value: number) => value.toLocaleString("zh-CN");

/** Total clicks with the recent window underneath. Right-aligned numerals so a column scans. */
export function ClickCount({ clicks }: { clicks: PromotionClicks | null }) {
  if (clicks === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end">
      <span className="font-medium tabular-nums">{zh(clicks.total)}</span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {RECENT_LABEL} {zh(clicks.recent)}
      </span>
    </div>
  );
}

/** Inline version for the cards on mobile, where a two-line cell would waste a row. */
export function ClickBadge({ clicks }: { clicks: PromotionClicks | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs tabular-nums">
      <MousePointerClickIcon className="size-3.5" aria-hidden />
      {clicks === null ? "—" : `${zh(clicks.total)} 次 · ${RECENT_LABEL} ${zh(clicks.recent)}`}
    </span>
  );
}

/**
 * Daily clicks as a bar list. No chart library: a row per day with a width-proportional bar reads
 * better at 14 points than a line chart, and stays legible on a phone.
 */
export function ClickHistory({ promotionId }: { promotionId: number }) {
  const history = useQuery(clickHistoryQueryOptions(promotionId));

  if (history.isPending) {
    return (
      <div className="flex flex-col gap-1">
        {["a", "b", "c", "d", "e", "f"].map((key) => (
          <Skeleton key={key} className="h-5 rounded" />
        ))}
      </div>
    );
  }
  if (history.isError) {
    return <p className="text-destructive-foreground text-sm">加载失败：{history.error.message}</p>;
  }

  const points = history.data;
  const peak = Math.max(...points.map((point) => point.clicks));
  const total = points.reduce((sum, point) => sum + point.clicks, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">近 {points.length} 天</span>
        <span className="font-medium tabular-nums">{zh(total)} 次点击</span>
      </div>
      {total === 0 ? (
        <p className="py-4 text-center text-muted-foreground text-sm">这段时间还没有点击</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {points.map((point) => (
            <Bar key={point.day} point={point} peak={peak} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Bar({ point, peak }: { point: ClickPoint; peak: number }) {
  // Relative to the busiest day, so a quiet promotion still shows shape instead of five dots.
  const width = peak === 0 ? 0 : (point.clicks / peak) * 100;
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
        {shortDay(point.day)}
      </span>
      <span className="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
        <span
          className="block h-full rounded-sm bg-info-foreground/70"
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right tabular-nums">{point.clicks}</span>
    </li>
  );
}
