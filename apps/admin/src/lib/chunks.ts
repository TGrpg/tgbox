/**
 * Runs `run` over `ids` a slice at a time, one request after another. Bulk server functions take
 * at most a request's worth of ids (the 50-subrequest limit counts every D1 call and t.me fetch),
 * so a larger selection in the UI becomes several requests instead of one that fails halfway.
 *
 * A failed request stops the rest. When earlier requests already went through, the error is a
 * `PartialFailure` naming those ids, so the caller can keep them as done rather than roll back
 * changes the server already made. The failed request's own outcome is unknown: refetch.
 */
export async function inChunks<T>(
  ids: number[],
  size: number,
  run: (chunk: number[]) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  for (let start = 0; start < ids.length; start += size) {
    try {
      results.push(await run(ids.slice(start, start + size)));
    } catch (error) {
      if (start === 0) throw error;
      throw new PartialFailure(ids.slice(0, start), ids.length, error);
    }
  }
  return results;
}

export class PartialFailure extends Error {
  constructor(
    /** Ids of the requests that succeeded. */
    readonly doneIds: number[],
    readonly total: number,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

/** Toast copy for a failed bulk action, saying how much of it went through. */
export function failureToast(error: Error) {
  if (!(error instanceof PartialFailure)) {
    return { type: "error" as const, title: "操作失败", description: error.message };
  }
  return {
    type: "warning" as const,
    title: `已完成 ${error.doneIds.length} 条，其余 ${error.total - error.doneIds.length} 条未完成`,
    description: `${error.message}。请刷新后重试未完成的部分。`,
  };
}
