import { defineConfig } from "drizzle-kit";

// Migrations are applied with `wrangler d1 migrations apply` (apps/bot points at this dir).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
