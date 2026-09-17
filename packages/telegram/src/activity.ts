import type { ActivityTier, PostView } from "@tgbox/shared";

const DAY_MS = 86_400_000;
const WINDOW_MS = 30 * DAY_MS;
/** t.me/s/ shows at most this many posts. */
const PAGE_SIZE = 20;

/**
 * Channel activity tier from the recent /s/ page.
 *
 * Posts per 30 days: 0 → tier 0, 1–3 → 1, 4–14 → 2, 15–59 → 3, ≥ 60 → 4.
 * A full page (20 posts) that lies entirely within the window is extrapolated to 30 days,
 * since the page caps how many posts we can see.
 * Average views under 100 lowers the tier by one (never below 1 while posting).
 */
export function activityTier(posts: PostView[], now: Date): ActivityTier {
  const since = now.getTime() - WINDOW_MS;
  const recent = posts.filter((post) => Date.parse(post.date) >= since);
  if (recent.length === 0) return 0;

  let perWindow = recent.length;
  if (recent.length === posts.length && posts.length >= PAGE_SIZE) {
    const oldest = Math.min(...posts.map((post) => Date.parse(post.date)));
    const span = Math.max(now.getTime() - oldest, DAY_MS);
    perWindow = (recent.length * WINDOW_MS) / span;
  }

  let tier: ActivityTier = perWindow >= 60 ? 4 : perWindow >= 15 ? 3 : perWindow >= 4 ? 2 : 1;

  const viewed = recent.flatMap((post) => (post.views === null ? [] : [post.views]));
  const avgViews = viewed.length ? viewed.reduce((a, b) => a + b, 0) / viewed.length : null;
  if (avgViews !== null && avgViews < 100 && tier > 1) tier = lower(tier);
  return tier;
}

function lower(tier: ActivityTier): ActivityTier {
  return tier === 4 ? 3 : tier === 3 ? 2 : 1;
}
