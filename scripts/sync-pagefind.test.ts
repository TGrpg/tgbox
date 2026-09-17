import assert from "node:assert/strict";
import { test } from "node:test";
import { diffManifest, isImmutable } from "./sync-pagefind.ts";

test("uploads new and changed files, removes files the new build dropped", () => {
  const previous = {
    "pagefind.js": "a",
    "fragment/zh_old.pf_fragment": "b",
    "index/zh_1.pf_index": "c",
  };
  const next = {
    "pagefind.js": "a2",
    "fragment/zh_new.pf_fragment": "d",
    "index/zh_1.pf_index": "c",
  };
  assert.deepEqual(diffManifest(previous, next), {
    upload: ["fragment/zh_new.pf_fragment", "pagefind.js"],
    remove: ["fragment/zh_old.pf_fragment"],
  });
});

test("first run uploads everything and removes nothing", () => {
  assert.deepEqual(diffManifest({}, { "pagefind.js": "a" }), {
    upload: ["pagefind.js"],
    remove: [],
  });
});

test("only hashed chunk files are cached as immutable", () => {
  assert.equal(isImmutable("fragment/zh_abc.pf_fragment"), true);
  assert.equal(isImmutable("pagefind.zh_abc.pf_meta"), true);
  assert.equal(isImmutable("pagefind-entry.json"), false);
  assert.equal(isImmutable("pagefind.js"), false);
});
