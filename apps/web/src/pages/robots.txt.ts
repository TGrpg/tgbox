import type { APIRoute } from "astro";
import { absoluteUrl } from "@/lib/site.ts";

export const GET: APIRoute = () =>
  new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "",
      `Sitemap: ${absoluteUrl("/sitemap-index.xml")}`,
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
