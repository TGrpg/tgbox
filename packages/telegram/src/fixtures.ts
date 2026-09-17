import { readFileSync } from "node:fs";

/** Test-only helper: reads a saved t.me page from `fixtures/`. */
export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}
