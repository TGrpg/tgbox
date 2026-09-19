import type { APIRoute } from "astro";
import { openData } from "@/lib/open-data.ts";
import { getSiteData } from "@/lib/site-data.ts";

/** Every listed entry with its public fields, for mirrors (see `openData`). */
export const GET: APIRoute = () => Response.json(openData(getSiteData()));
