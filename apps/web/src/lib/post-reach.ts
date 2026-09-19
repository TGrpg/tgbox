import type { PostView } from "@tgbox/shared";

/** Fewer counted posts than this make an average that one viral post decides on its own. */
const MIN_POSTS = 3;

/**
 * Average views of the recent posts, and that average as a share of the subscribers — the reach
 * figure channel analytics sites lead with. Built from the preview the refresh already fetched.
 */
export function postReach(posts: readonly PostView[], members: number | null) {
  const views = posts.flatMap((post) => (post.views === null ? [] : [post.views]));
  if (views.length < MIN_POSTS) return null;
  const avgViews = Math.round(views.reduce((sum, n) => sum + n, 0) / views.length);
  return { avgViews, rate: members ? avgViews / members : null };
}
