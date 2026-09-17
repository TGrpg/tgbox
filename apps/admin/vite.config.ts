import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 8789, strictPort: true, host: "127.0.0.1" },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Share the local D1/R2 state with the bot (`wrangler dev --persist-to ../../.data/wrangler`).
      persistState: { path: path.resolve(import.meta.dirname, "../../.data/wrangler") },
    }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
