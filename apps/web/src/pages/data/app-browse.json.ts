import type { APIRoute } from "astro";
import { appBrowse } from "@/lib/app-data.ts";
import { getSiteData } from "@/lib/site-data.ts";

/** Browse screen of the Telegram Mini App; read straight from the CDN, never through the Worker. */
export const GET: APIRoute = () => Response.json(appBrowse(getSiteData()));
