import { useEffect, useState } from "react";

export type StaticState<TData> =
  | { status: "loading" }
  | { status: "ready"; data: TData }
  | { status: "error" };

/**
 * Reads one of the JSON files the site build writes under `/data/`. These are static assets, so
 * they cost no Worker request; they are our own build output, so they are not re-validated here.
 */
export function useStaticJson<TData>(url: string): StaticState<TData> {
  const [state, setState] = useState<StaticState<TData>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data: TData = await response.json();
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
