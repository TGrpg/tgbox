import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/** Matches Tailwind's `md` breakpoint (table on desktop, cards below). */
export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
