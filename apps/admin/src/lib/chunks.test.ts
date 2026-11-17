import { expect, test } from "vitest";
import { failureToast, inChunks, PartialFailure } from "./chunks.ts";

test("a selection is sent in order, one request per slice", async () => {
  const sent: number[][] = [];
  const results = await inChunks([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (chunk) => {
    sent.push(chunk);
    return chunk.length;
  });
  expect(sent).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  expect(results).toEqual([4, 4, 1]);
});

test("a failed first slice is the plain error: nothing went through", async () => {
  const error = await inChunks([1, 2], 1, async () => {
    throw new Error("offline");
  }).catch((e: unknown) => e);
  expect(error).not.toBeInstanceOf(PartialFailure);
  expect(failureToast(error as Error)).toMatchObject({ type: "error", description: "offline" });
});

test("a later failure stops the rest and names the slices that went through", async () => {
  const sent: number[][] = [];
  const error = await inChunks([1, 2, 3, 4, 5], 2, async (chunk) => {
    sent.push(chunk);
    if (chunk[0] === 3) throw new Error("limit");
  }).catch((e: unknown) => e);
  expect(sent).toEqual([
    [1, 2],
    [3, 4],
  ]);
  expect(error).toBeInstanceOf(PartialFailure);
  expect(error).toMatchObject({ doneIds: [1, 2], total: 5, message: "limit" });
  expect(failureToast(error as Error)).toMatchObject({
    type: "warning",
    title: "已完成 2 条，其余 3 条未完成",
  });
});
