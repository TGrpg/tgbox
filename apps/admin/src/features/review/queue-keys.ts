export type ReviewShortcut = "approve" | "reject" | "next" | "prev";

const shortcuts: Record<string, ReviewShortcut> = {
  a: "approve",
  r: "reject",
  j: "next",
  k: "prev",
};

/** `editable`: the event target is an input, textarea, select or contenteditable. */
export function reviewShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  editable: boolean;
}): ReviewShortcut | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.editable) return null;
  return shortcuts[event.key.toLowerCase()] ?? null;
}

export function moveActive(ids: number[], active: number | null, delta: 1 | -1) {
  if (ids.length === 0) return null;
  const index = active === null ? -1 : ids.indexOf(active);
  if (index === -1) return ids[0] ?? null;
  return ids[Math.max(0, Math.min(ids.length - 1, index + delta))] ?? null;
}

/** Keeps review flowing: the row after the removed active one, else the nearest one before it. */
export function activeAfterRemoval(ids: number[], removed: number[], active: number | null) {
  if (active === null || !removed.includes(active)) return active;
  const index = ids.indexOf(active);
  const gone = new Set(removed);
  const after = ids.slice(index + 1).find((id) => !gone.has(id));
  if (after !== undefined) return after;
  for (let i = index - 1; i >= 0; i--) {
    const id = ids[i];
    if (id !== undefined && !gone.has(id)) return id;
  }
  return null;
}
