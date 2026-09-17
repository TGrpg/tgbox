/** Renders a value as a SQLite literal for generated `.sql` files run by `wrangler d1 execute`. */
export function sqlValue(value: string | number | boolean | null): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}
