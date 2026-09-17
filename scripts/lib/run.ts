import { spawnSync } from "node:child_process";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "../..");

/** Runs a command with inherited stdio (or captured stdout) and throws on a non-zero exit. */
export function run(
  command: string,
  args: string[],
  options: { cwd?: string; capture?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  const cwd = options.cwd ?? repoRoot;
  console.log(
    `$ ${[command, ...args].join(" ")}${cwd === repoRoot ? "" : `  (in ${path.relative(repoRoot, cwd)})`}`,
  );
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: options.capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result.stdout ?? "";
}

/** `wrangler` from apps/bot, whose config owns the D1 database and R2 bucket bindings. */
export function wrangler(args: string[], options: { capture?: boolean } = {}) {
  return run("pnpm", ["exec", "wrangler", ...args], {
    cwd: path.join(repoRoot, "apps/bot"),
    ...options,
  });
}
