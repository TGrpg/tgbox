// Incremental upload of apps/web/dist/pagefind to R2 under `pagefind/`, via the S3 API (aws CLI).
// Pagefind chunk names are content hashes, so a rebuild usually changes only a few files.
//   node scripts/sync-pagefind.ts upload   before `wrangler deploy`: put new/changed files
//   node scripts/sync-pagefind.ts prune    after deploy: delete files the new build no longer has,
//                                          then store the manifest for the next run
// Env: R2_BUCKET (default tgbox-media), CLOUDFLARE_ACCOUNT_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot, run } from "./lib/run.ts";

export type Manifest = Record<string, string>;

const PREFIX = "pagefind";
const MANIFEST_KEY = `${PREFIX}/manifest.json`;

export function diffManifest(previous: Manifest, next: Manifest) {
  return {
    upload: Object.keys(next)
      .filter((file) => previous[file] !== next[file])
      .sort(),
    remove: Object.keys(previous)
      .filter((file) => !(file in next))
      .sort(),
  };
}

/** Hashed chunk files never change in place; entry files (pagefind.js, pagefind-entry.json…) do. */
export function isImmutable(file: string) {
  return /^(fragment|index|filter)\//.test(file) || file.endsWith(".pf_meta");
}

async function localManifest(dir: string): Promise<Manifest> {
  const manifest: Manifest = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const key = path.relative(dir, file).split(path.sep).join("/");
    manifest[key] = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  }
  return manifest;
}

function aws(args: string[], capture = false) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
  return run("aws", [...args, "--endpoint-url", `https://${account}.r2.cloudflarestorage.com`], {
    capture,
    // R2 rejects the default CRC checksums newer aws CLI versions send.
    env: {
      AWS_DEFAULT_REGION: "auto",
      AWS_REQUEST_CHECKSUM_CALCULATION: "when_required",
      AWS_RESPONSE_CHECKSUM_VALIDATION: "when_required",
    },
  });
}

async function remoteManifest(bucket: string): Promise<Manifest> {
  try {
    const parsed: unknown = JSON.parse(
      aws(["s3", "cp", `s3://${bucket}/${MANIFEST_KEY}`, "-"], true),
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      ),
    );
  } catch {
    console.log("no previous Pagefind manifest; uploading everything");
    return {};
  }
}

if (import.meta.main) {
  const phase = process.argv[2];
  if (phase !== "upload" && phase !== "prune") {
    console.error("Usage: sync-pagefind.ts upload|prune");
    process.exit(1);
  }
  const bucket = process.env.R2_BUCKET ?? "tgbox-media";
  const dir = path.join(repoRoot, "apps/web/dist/pagefind");
  const next = await localManifest(dir);
  const previous = await remoteManifest(bucket);
  const { upload, remove } = diffManifest(previous, next);

  if (phase === "upload") {
    const staging = await mkdtemp(path.join(tmpdir(), "pagefind-"));
    for (const immutable of [true, false]) {
      const files = upload.filter((file) => isImmutable(file) === immutable);
      if (files.length === 0) continue;
      const batch = path.join(staging, immutable ? "immutable" : "mutable");
      for (const file of files) {
        await mkdir(path.dirname(path.join(batch, file)), { recursive: true });
        await cp(path.join(dir, file), path.join(batch, file));
      }
      const cacheControl = immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300";
      aws([
        "s3",
        "cp",
        batch,
        `s3://${bucket}/${PREFIX}/`,
        "--recursive",
        "--only-show-errors",
        "--cache-control",
        cacheControl,
      ]);
    }
    console.log(`pagefind sync: uploaded ${upload.length} of ${Object.keys(next).length} files`);
  } else {
    // delete-objects takes at most 1,000 keys per call.
    for (let i = 0; i < remove.length; i += 1000) {
      const objects = remove.slice(i, i + 1000).map((file) => ({ Key: `${PREFIX}/${file}` }));
      aws([
        "s3api",
        "delete-objects",
        "--bucket",
        bucket,
        "--delete",
        JSON.stringify({ Objects: objects, Quiet: true }),
      ]);
    }
    const manifestFile = path.join(
      await mkdtemp(path.join(tmpdir(), "pagefind-")),
      "manifest.json",
    );
    await writeFile(manifestFile, JSON.stringify(next));
    aws([
      "s3",
      "cp",
      manifestFile,
      `s3://${bucket}/${MANIFEST_KEY}`,
      "--content-type",
      "application/json",
      "--cache-control",
      "no-store",
    ]);
    console.log(
      `pagefind sync: deleted ${remove.length} stale files, manifest has ${Object.keys(next).length}`,
    );
  }
}
