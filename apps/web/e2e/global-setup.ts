import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { devSiteData } from "../src/lib/dev-site-data.ts";
import { serveStatic } from "./static-server.ts";

// Seam C: dev fixture data → `astro build` → local Pagefind index → static server.
const webRoot = path.resolve(import.meta.dirname, "..");
// Node prerendering imports externalized deps from the output, so it must live under apps/web/node_modules.
const outDir = path.join(webRoot, "node_modules/.cache/e2e-build");
export const port = 4329;

export default async function globalSetup() {
  rmSync(outDir, { recursive: true, force: true });
  // Outside outDir: `astro build` empties it.
  const work = path.join(webRoot, "node_modules/.cache/e2e-data");
  mkdirSync(work, { recursive: true });
  // Pinned explicitly so a local `.data/site-data.json` can't change what the tests see.
  const dataPath = path.join(work, "site-data.json");
  writeFileSync(dataPath, JSON.stringify(devSiteData));
  const env = {
    ...process.env,
    SITE_DATA_PATH: dataPath,
    SITE_URL: `http://127.0.0.1:${port}`,
    PAGEFIND_LOCAL: "1",
  };
  execFileSync(path.join(webRoot, "node_modules/.bin/astro"), ["build", "--outDir", outDir], {
    cwd: webRoot,
    env,
    stdio: "pipe",
  });
  execFileSync(process.execPath, ["scripts/pagefind.ts", outDir], {
    cwd: webRoot,
    env,
    stdio: "pipe",
  });
  return serveStatic(path.join(outDir, "client"), port);
}
