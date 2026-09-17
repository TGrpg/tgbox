const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const point =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** HTML fragment → plain text: `<br>` becomes a newline, other tags are dropped. */
export function htmlToText(fragment: string): string {
  const text = decodeEntities(fragment.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""));
  return text
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** Inner HTML of the first `<div class="…{className}…">`, up to its first closing `</div>`. */
export function divContent(html: string, className: string): string | null {
  const match = new RegExp(`<div class="${className}(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)</div>`).exec(
    html,
  );
  return match?.[1] ?? null;
}

/** Parses Telegram's exact counts: "9 538 357", "1,234", with (thin) non-breaking spaces. */
export function parseCount(text: string): number | null {
  const digits = text.replace(/[\s,.   ']/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : null;
}
