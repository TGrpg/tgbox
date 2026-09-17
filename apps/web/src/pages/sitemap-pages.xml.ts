import type { APIRoute } from "astro";
import { pagesSitemap } from "@/lib/sitemap.ts";

export const GET: APIRoute = () => pagesSitemap();
