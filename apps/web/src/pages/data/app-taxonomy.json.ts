import type { APIRoute } from "astro";
import { appTaxonomy } from "@/lib/app-data.ts";
import { getSiteData } from "@/lib/site-data.ts";

/** Categories and tags (both locales) behind the Mini App's submit pickers. */
export const GET: APIRoute = () => Response.json(appTaxonomy(getSiteData()));
