/**
 * Counts what one cron invocation spends of its 50 subrequests: every D1 query or batch and every
 * fetch made through the wrapped binding and fetch. Jobs that share an invocation hand the count to
 * the next instead of estimating their own cost, so a job that throws halfway still reports what
 * it used.
 */
export function countSubrequests(db: D1Database, fetchFn: typeof fetch) {
  let used = 0;
  const inners = new WeakMap<object, D1PreparedStatement>();
  const statement = (inner: D1PreparedStatement): D1PreparedStatement => {
    const outer = new Proxy(inner, {
      get(target, key) {
        if (key === "bind") {
          return (...values: unknown[]) => statement(target.bind(...values));
        }
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key === "run" || key === "all" || key === "first" || key === "raw") {
          return (...args: unknown[]) => {
            used++;
            return value.apply(target, args);
          };
        }
        return value.bind(target);
      },
    });
    inners.set(outer, inner);
    return outer;
  };
  const counted = new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (query: string) => statement(target.prepare(query));
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (key === "batch") {
        // One subrequest for the whole batch, run on the binding's own statements.
        return (statements: D1PreparedStatement[]) => {
          used++;
          return target.batch(statements.map((s) => inners.get(s) ?? s));
        };
      }
      if (key === "exec") {
        return (query: string) => {
          used++;
          return target.exec(query);
        };
      }
      return value.bind(target);
    },
  });
  return {
    db: counted,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      used++;
      return fetchFn(input, init);
    }) as typeof fetch,
    used: () => used,
  };
}
