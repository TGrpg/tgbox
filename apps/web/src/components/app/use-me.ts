import { AppMe } from "@tgbox/shared";
import { useCallback, useEffect, useState } from "react";
import { meCacheUse } from "@/lib/app-me.ts";
import { type ApiError, apiCall } from "./api.ts";
import { storeLocale } from "./locale.ts";
import { launchUser } from "./telegram.ts";

const CACHE_KEY = "tgbox-app:me";

export type MeState =
  | { status: "loading" }
  | { status: "ready"; me: AppMe }
  | { status: "error"; error: ApiError };

type Cached = { userId: number | null; at: number; me: AppMe };

const launchUserId = () => launchUser()?.id ?? null;

function cached(): Cached | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { userId, at, me } = JSON.parse(raw) as Partial<Record<keyof Cached, unknown>>;
    const parsed = AppMe.safeParse(me);
    if (!parsed.success || typeof at !== "number") return null;
    if (userId !== null && typeof userId !== "number") return null;
    return { userId, at, me: parsed.data };
  } catch {
    return null;
  }
}

function cache(me: AppMe | null) {
  try {
    if (me) {
      const entry: Cached = { userId: launchUserId(), at: Date.now(), me };
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } else {
      sessionStorage.removeItem(CACHE_KEY);
    }
  } catch {
    // Without the cache the next screen simply fetches again.
  }
}

/** Drops the cached `/me` after the user changed something it lists (an order, a payment). */
export const forgetMe = () => cache(null);

/**
 * `/api/app/me` is kept in sessionStorage, because the four screens are separate documents and the
 * Worker budget is the reason this app is laid out that way. A copy younger than `ME_FRESH_MS` is
 * used as is; an older one is shown at once and fetched again behind it, so a review or payment
 * that happened elsewhere shows up the next time the user opens a screen. Nothing polls it.
 */
export function useMe(): { state: MeState; reload: () => void } {
  const [initial] = useState(() => {
    const entry = cached();
    return { entry, use: meCacheUse(entry, launchUserId(), Date.now()) };
  });
  const [state, setState] = useState<MeState>(() =>
    initial.entry && initial.use !== "none"
      ? { status: "ready", me: initial.entry.me }
      : { status: "loading" },
  );
  const [request, setRequest] = useState(initial.use === "fresh" ? 0 : 1);

  useEffect(() => {
    if (request === 0) return;
    let cancelled = false;
    void apiCall("/me", AppMe).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        cache(result.data);
        storeLocale(result.data.user.locale);
        setState({ status: "ready", me: result.data });
      } else {
        // A failed refresh behind a shown copy keeps the copy rather than blanking the screen.
        setState((current) =>
          current.status === "ready" ? current : { status: "error", error: result.error },
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const reload = useCallback(() => {
    cache(null);
    setState({ status: "loading" });
    setRequest((value) => value + 1);
  }, []);

  return { state, reload };
}
