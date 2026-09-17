import type { APIRoute } from "astro";
import { appProducts } from "@/lib/app-data.ts";
import { getSiteData } from "@/lib/site-data.ts";

/** Promotion price list for the Mini App's purchase screen. */
export const GET: APIRoute = () => Response.json(appProducts(getSiteData()));
