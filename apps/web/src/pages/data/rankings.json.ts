import { RankingsData } from "@tgbox/shared";
import type { APIRoute } from "astro";
import { buildRankings } from "@/lib/rankings.ts";
import { getSiteData } from "@/lib/site-data.ts";

/** Rankings for other consumers (the bot's digest); validated so a bad build fails instead of shipping. */
export const GET: APIRoute = () => {
  const data = getSiteData();
  return Response.json(RankingsData.parse(buildRankings(data, new Date(data.generatedAt))));
};
