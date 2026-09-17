import { readdir } from "node:fs/promises";

// Cloudflare Workers static assets allow 20,000 files per version.
const WARN_ABOVE = 18_000;
const FAIL_ABOVE = 20_000;

export function checkStaticFileCount(count: number): "ok" | "warn" | "fail" {
  if (count > FAIL_ABOVE) return "fail";
  if (count > WARN_ABOVE) return "warn";
  return "ok";
}

export async function countFiles(dir: string): Promise<number> {
  const items = await readdir(dir, { recursive: true, withFileTypes: true });
  return items.filter((item) => item.isFile()).length;
}
