import { AppMe } from "@tgbox/shared";
import { useCallback, useEffect, useState } from "react";
import { type ApiError, apiCall } from "./api.ts";
import { storeLocale } from "./locale.ts";

const CACHE_KEY = "tgbox-app:me";

export type MeState =
  | { status: "loading" }
  | { status: "ready"; me: AppMe }
  | { status: "error"; error: ApiError };

function cached(): AppMe | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = AppMe.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function cache(me: AppMe | null) {
  try {
    if (me) sessionStorage.setItem(CACHE_KEY, JSON.stringify(me));
    else sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // Without the cache the next screen simply fetches again.
  }
}

/**
 * `/api/app/me` is fetched once per session and kept in sessionStorage, because the four screens
 * are separate documents and the Worker budget is the reason this app is laid out that way.
 * Nothing polls it; `reload` is called only after the user changed something.
 */
export function useMe(): { state: MeState; reload: () => void } {
  const [state, setState] = useState<MeState>(() => {
    const me = cached();
    return me ? { status: "ready", me } : { status: "loading" };
  });
  const [request, setRequest] = useState(() => (cached() === null ? 1 : 0));

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
        setState({ status: "error", error: result.error });
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
