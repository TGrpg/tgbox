import type { APIRoute } from "astro";
import { awesomeData } from "@/lib/awesome-data.ts";
import { getSiteData } from "@/lib/site-data.ts";

/** What the awesome-telegram README shows (see `awesomeData`). */
export const GET: APIRoute = () => Response.json(awesomeData(getSiteData()));
