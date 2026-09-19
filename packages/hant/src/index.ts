import { Converter } from "opencc-js";

/**
 * Simplified → Traditional Chinese, for build steps only: the OpenCC dictionaries are ~1 MB and
 * building them costs more CPU than a Worker request has, so nothing deployed may import this.
 *
 * Character forms only ("cn" → "tw" standard glyphs, no Taiwan-specific vocabulary), so the text
 * reads naturally in Taiwan and Hong Kong alike.
 */
const convert = Converter({ from: "cn", to: "tw" });

// Phrases OpenCC misreads ("一个中文频道" → 箇中, "并发送" → 併發, …).
const fixes: [wrong: string, right: string][] = [
  ["一箇中", "一個中"],
  ["併發送", "並發送"],
  ["併發言", "並發言"],
  ["併購買", "並購買"],
  ["是隻", "是只"],
];

export function toHant(text: string): string {
  let out = convert(text);
  for (const [wrong, right] of fixes) out = out.replaceAll(wrong, right);
  return out;
}
