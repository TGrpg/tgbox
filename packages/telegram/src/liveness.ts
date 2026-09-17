import type { EntryKind, Liveness } from "@tgbox/shared";
import { type ProfileKind, parseProfile } from "./profile.ts";

export type ProfileResponse = { status: number; html: string };

export type LivenessInput = {
  /** null when the request failed (network error, timeout) */
  profileResponse: ProfileResponse | null;
  /** kind stored in the database; null for a new submission */
  previousKind: EntryKind | null;
  /** the channel's `/s/{u}` preview used to work and now redirects */
  previewRedirected?: boolean;
};

/** Order follows spec §失效判定. `unknown` never counts as a failure. */
export function classifyLiveness(input: LivenessInput): {
  liveness: Liveness;
  kind: ProfileKind | null;
} {
  const res = input.profileResponse;
  if (res?.status !== 200) return { liveness: "unknown", kind: null };

  const profile = parseProfile(res.html, usernameFromPage(res.html));
  switch (profile.pageShape) {
    case "malformed":
      return { liveness: "unknown", kind: null };
    case "view":
      return { liveness: "banned", kind: null };
    case "contact":
      return { liveness: "not_found", kind: null };
  }
  if (!profile.kind) return { liveness: "unknown", kind: null };
  if (input.previousKind && profile.kind !== input.previousKind) {
    return { liveness: "type_changed", kind: profile.kind };
  }
  if (input.previewRedirected && profile.kind === "channel") {
    return { liveness: "banned", kind: profile.kind };
  }
  return { liveness: "active", kind: profile.kind };
}

/** Every t.me profile page carries `tg://resolve?domain={u}`. */
function usernameFromPage(html: string): string {
  return /tg:\/\/resolve\?domain=([A-Za-z0-9_]+)/.exec(html)?.[1] ?? "";
}
