import type { APIRoute } from "astro";
import { sitemapIndex } from "@/lib/sitemap.ts";

export const GET: APIRoute = () => sitemapIndex();
