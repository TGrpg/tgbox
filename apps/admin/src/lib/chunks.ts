/**
 * Runs `run` over `ids` a slice at a time, one request after another. Bulk server functions take
 * at most a request's worth of ids (the 50-subrequest limit counts every D1 call and t.me fetch),
 * so a larger selection in the UI becomes several requests instead of one that fails halfway.
 */
export async function inChunks<T>(
  ids: number[],
  size: number,
  run: (chunk: number[]) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  for (let start = 0; start < ids.length; start += size) {
    results.push(await run(ids.slice(start, start + size)));
  }
  return results;
}
