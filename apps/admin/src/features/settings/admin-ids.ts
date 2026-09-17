/**
 * Parses typed admin ids ("123, 456 789") for the tag input. Super admins and ids already added
 * are skipped; anything that is not a Telegram user id is reported back.
 */
export function addAdminIds(text: string, current: string[], superAdminIds: string[]) {
  const tokens = text.split(/[\s,，]+/).filter(Boolean);
  const invalid = tokens.filter((token) => !/^\d{1,20}$/.test(token));
  const ids = [...current];
  for (const token of tokens) {
    if (invalid.includes(token) || ids.includes(token) || superAdminIds.includes(token)) continue;
    ids.push(token);
  }
  return { ids, invalid };
}

export const isChatId = (value: string) => /^-?\d{1,20}$/.test(value);

/** Accepts @name or a t.me link; the setting stores the bare username. */
export function normalizeSupportUsername(value: string) {
  const name = value
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@/, "");
  return name === "" ? null : name;
}
