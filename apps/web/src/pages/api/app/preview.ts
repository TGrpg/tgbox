import { entryKinds, type PreviewResult, parseTelegramRef } from "@tgbox/shared";
import { fetchEntrySnapshot } from "@tgbox/telegram";
import type { APIRoute } from "astro";
import { appJson, authenticateApp } from "@/lib/app-auth.ts";

export const prerender = false;

/**
 * Per-user rate limit, kept in the isolate rather than in D1 or KV: a write per preview would be
 * both a cost and a lie (isolates are per colo, so the count is approximate either way). It exists
 * to stop one person turning the submit form into a t.me crawler, not to enforce a quota exactly —
 * a determined user spread over several colos gets a few more. The map is bounded by pruning
 * everything outside the window whenever it grows.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const recent = new Map<number, number[]>();

function allow(userId: number, now: number) {
  if (recent.size > 1000) {
    for (const [id, times] of recent) {
      if (times.every((time) => now - time >= WINDOW_MS)) recent.delete(id);
    }
  }
  const times = (recent.get(userId) ?? []).filter((time) => now - time < WINDOW_MS);
  if (times.length >= MAX_PER_WINDOW) {
    recent.set(userId, times);
    return false;
  }
  times.push(now);
  recent.set(userId, times);
  return true;
}

/** What t.me says about a username, so the submit form can show it before anything is written. */
export const GET: APIRoute = async ({ request, url }) => {
  const auth = await authenticateApp(request);
  if (!auth.ok) return auth.response;
  const { user, core } = auth.session;

  const username = parseTelegramRef(url.searchParams.get("username") ?? "");
  if (!username) return appJson({ ok: false, error: "invalid" } satisfies PreviewResult);
  if (!allow(user.id, Date.now())) {
    // 429 carries the real reason; the body stays inside `PreviewResult`, which the contract gives
    // no "rate_limited" member, so a client that only parses the body sees a harmless "not found".
    return Response.json({ ok: false, error: "not_found" } satisfies PreviewResult, {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": "60" },
    });
  }

  const snap = await fetchEntrySnapshot(username, {
    fetch: core.fetch,
    now: new Date(core.now()),
    knownKind: null,
    needCreatedAt: false,
  });
  const kind = entryKinds.find((entryKind) => entryKind === snap.kind);
  // A user account is a valid t.me page but not something this directory lists.
  if (snap.liveness !== "active" || !kind || !snap.profile) {
    return appJson({ ok: false, error: "not_found" } satisfies PreviewResult);
  }

  const { profile } = snap;
  return appJson({
    ok: true,
    preview: {
      username,
      kind,
      title: profile.title ?? username,
      description: profile.description ?? "",
      members: profile.members ?? profile.monthlyUsers,
      avatarUrl: profile.avatarUrl,
    },
  } satisfies PreviewResult);
};
