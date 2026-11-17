import { expect, test } from "vitest";
import { inChunks } from "./chunks.ts";

test("a selection is sent in order, one request per slice", async () => {
  const sent: number[][] = [];
  const results = await inChunks([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (chunk) => {
    sent.push(chunk);
    return chunk.length;
  });
  expect(sent).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  expect(results).toEqual([4, 4, 1]);
});

test("a failed slice stops the rest", async () => {
  const sent: number[][] = [];
  await expect(
    inChunks([1, 2, 3], 1, async (chunk) => {
      sent.push(chunk);
      if (chunk[0] === 2) throw new Error("limit");
    }),
  ).rejects.toThrow("limit");
  expect(sent).toEqual([[1], [2]]);
});
