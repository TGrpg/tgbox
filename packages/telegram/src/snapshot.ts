import type { ActivityTier, EntryKind, Liveness, PostView } from "@tgbox/shared";
import { activityTier } from "./activity.ts";
import { parseChannelPage, parseCreatedAt } from "./channel.ts";
import { detectLanguage } from "./language.ts";
import { classifyLiveness, type ProfileResponse } from "./liveness.ts";
import { type Profile, type ProfileKind, parseProfile } from "./profile.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const TIMEOUT_MS = 8_000;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type SnapshotOptions = {
  fetch: Fetch;
  now: Date;
  /** kind stored in the database; null for a new submission */
  knownKind: EntryKind | null;
  /**
   * fetch the first message for the creation date (only while tg_created_at is empty): `/s/{u}/1`
   * for a channel, the `/{u}/1` embed for a group (groups have no /s/ preview)
   */
  needCreatedAt: boolean;
};

export type EntrySnapshot = {
  liveness: Liveness;
  kind: ProfileKind | null;
  profile: Profile | null;
  /** channels only; null when the preview wasn't available */
  posts: PostView[] | null;
  createdAt: string | null;
  lang: string | null;
  /** channels with a preview only */
  activityTier: ActivityTier | null;
  subrequests: number;
  /** t.me answered 429: the caller should mark the rest of this round as unknown */
  rateLimited: boolean;
};

type Page = { status: number; html: string; redirected: boolean } | null;

/** Fetches and interprets one entry's t.me pages. Never throws; transport failures → unknown. */
export async function fetchEntrySnapshot(
  username: string,
  options: SnapshotOptions,
): Promise<EntrySnapshot> {
  let subrequests = 0;
  let rateLimited = false;

  async function get(path: string): Promise<Page> {
    subrequests++;
    try {
      const res = await options.fetch(`https://t.me${path}`, {
        headers: { "user-agent": USER_AGENT, "accept-language": "en" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429) rateLimited = true;
      const redirected = res.status >= 300 && res.status < 400;
      return { status: res.status, html: redirected ? "" : await res.text(), redirected };
    } catch {
      return null;
    }
  }

  const snapshot: EntrySnapshot = {
    liveness: "unknown",
    kind: null,
    profile: null,
    posts: null,
    createdAt: null,
    lang: null,
    activityTier: null,
    subrequests: 0,
    rateLimited: false,
  };

  const profilePage = await get(`/${username}`);
  const profileResponse: ProfileResponse | null =
    profilePage && !profilePage.redirected ? profilePage : null;
  if (profileResponse?.status === 200) {
    snapshot.profile = parseProfile(profileResponse.html, username);
  }
  let verdict = classifyLiveness({ profileResponse, previousKind: options.knownKind });

  if (verdict.liveness === "active" && verdict.kind === "channel") {
    const preview = await get(`/s/${username}`);
    if (preview?.redirected) {
      verdict = classifyLiveness({
        profileResponse,
        previousKind: options.knownKind,
        // Only an entry we already know as a channel "used to" have a preview.
        previewRedirected: options.knownKind === "channel",
      });
    } else if (preview?.status === 200) {
      const page = parseChannelPage(preview.html);
      if (page.hasPreview) {
        snapshot.posts = page.posts;
        snapshot.activityTier = activityTier(page.posts, options.now);
        if (options.needCreatedAt) {
          const first = await get(`/s/${username}/1`);
          if (first?.status === 200) snapshot.createdAt = parseCreatedAt(first.html);
        }
      }
    }
  }

  if (verdict.liveness === "active" && verdict.kind === "group" && options.needCreatedAt) {
    // Message 1 of a public group is its creation (or migration to a supergroup). When it was
    // deleted the embed says "Post not found" and the date stays unknown.
    const first = await get(`/${username}/1?embed=1&mode=tme`);
    if (first?.status === 200) snapshot.createdAt = parseCreatedAt(first.html);
  }

  snapshot.liveness = verdict.liveness;
  snapshot.kind = verdict.kind;
  if (verdict.liveness !== "not_found" && verdict.liveness !== "banned" && snapshot.profile) {
    const text = [
      snapshot.profile.title,
      snapshot.profile.description,
      ...(snapshot.posts ?? []).map((post) => post.text),
    ].join("\n");
    const lang = detectLanguage(text);
    snapshot.lang = lang === "und" ? null : lang;
  }
  if (verdict.liveness === "banned") {
    snapshot.posts = null;
    snapshot.activityTier = null;
  }
  snapshot.subrequests = subrequests;
  snapshot.rateLimited = rateLimited;
  return snapshot;
}
