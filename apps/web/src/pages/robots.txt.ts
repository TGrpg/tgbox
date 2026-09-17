import type { APIRoute } from "astro";
import { absoluteUrl } from "@/lib/site.ts";

export const GET: APIRoute = () =>
  new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      // JSON pools, the Telegram redirect helper and the promo click counter hold no content.
      "Disallow: /data/",
      "Disallow: /go/",
      "Disallow: /en/go/",
      "Disallow: /r/",
      "",
      `Sitemap: ${absoluteUrl("/sitemap-index.xml")}`,
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
