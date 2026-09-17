import type { APIRoute } from "astro";
import { guidesSitemap } from "@/lib/sitemap.ts";

export const GET: APIRoute = () => guidesSitemap();
