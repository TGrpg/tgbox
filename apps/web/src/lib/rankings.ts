import type {
  EntryView,
  Locale,
  MemberPoint,
  RankItem,
  RankingsData,
  SiteData,
} from "@tgbox/shared";
import { formatNumber } from "./format.ts";

/** Rows per ranking list (also the cap of each list in `/data/rankings.json`). */
export const RANK_LIMIT = 50;

const DAY_MS = 86_400_000;
// History points are sampled weekly while builds run more often, so a "week-old" point can be a few
// hours short of 7 days; one day of slack keeps the ranking from flickering empty on those builds.
const WEEK_BASE_DAYS = 6;
const MONTH_BASE_DAYS = 27;

export interface Growth {
  growth: number;
  /** Percent relative to the base point, one decimal; null when the base was 0. */
  growthPct: number | null;
}

/** Change of `members` against the latest history point at least `days` older than `now`. */
export function memberGrowth(
  members: number | null,
  history: MemberPoint[],
  now: Date,
  days: number,
): Growth | null {
  if (members === null) return null;
  const cutoff = now.getTime() - days * DAY_MS;
  const base = history.findLast((point) => Date.parse(point.t) <= cutoff);
  if (!base) return null;
  const growth = members - base.members;
  const growthPct = base.members > 0 ? Math.round((growth / base.members) * 1000) / 10 : null;
  return { growth, growthPct };
}

function rankItem(entry: EntryView, growth: Growth | null): RankItem {
  return {
    username: entry.username,
    kind: entry.kind,
    title: entry.title,
    members: entry.members,
    growth: growth?.growth ?? null,
    growthPct: growth?.growthPct ?? null,
    listedAt: entry.listedAt,
    activityTier: entry.activityTier,
  };
}

function growthRanking(entries: EntryView[], now: Date, days: number): RankItem[] {
  return entries
    .map((entry) => rankItem(entry, memberGrowth(entry.members, entry.memberHistory, now, days)))
    .filter((item) => (item.growth ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.growth ?? 0) - (a.growth ?? 0) ||
        (b.growthPct ?? 0) - (a.growthPct ?? 0) ||
        a.username.localeCompare(b.username),
    )
    .slice(0, RANK_LIMIT);
}

/**
 * Site-wide rankings (all kinds mixed) computed at build time from the snapshot. Ranks are by merit
 * only: promoted entries are not moved up. Newest and active rows carry the weekly growth, if any.
 */
export function buildRankings(data: SiteData, now: Date): RankingsData {
  const { entries } = data;
  const weekly = (entry: EntryView) =>
    rankItem(entry, memberGrowth(entry.members, entry.memberHistory, now, WEEK_BASE_DAYS));
  return {
    generatedAt: now.toISOString(),
    weeklyGrowth: growthRanking(entries, now, WEEK_BASE_DAYS),
    monthlyGrowth: growthRanking(entries, now, MONTH_BASE_DAYS),
    newest: [...entries]
      .sort((a, b) => b.listedAt.localeCompare(a.listedAt) || a.username.localeCompare(b.username))
      .slice(0, RANK_LIMIT)
      .map(weekly),
    // Only channels have a tier; dormant (0) entries don't belong in a "most active" list.
    active: entries
      .filter((entry) => (entry.activityTier ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.activityTier ?? 0) - (a.activityTier ?? 0) ||
          (b.members ?? -1) - (a.members ?? -1) ||
          a.username.localeCompare(b.username),
      )
      .slice(0, RANK_LIMIT)
      .map(weekly),
  };
}

/** "+1,234 (+5.2%)"; the percent is left out when unknown. */
export function formatGrowth(growth: number, growthPct: number | null, locale: Locale) {
  const sign = (value: number) => (value > 0 ? "+" : "");
  const count = `${sign(growth)}${formatNumber(growth, locale)}`;
  return growthPct === null ? count : `${count} (${sign(growthPct)}${growthPct}%)`;
}
