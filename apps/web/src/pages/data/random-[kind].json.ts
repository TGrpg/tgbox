import { RandomShardKey } from "@tgbox/shared";
import type { APIRoute, InferGetStaticPropsType } from "astro";
import { randomCards } from "@/lib/random-cards.ts";
import { getSiteData } from "@/lib/site-data.ts";

export function getStaticPaths() {
  return RandomShardKey.options.map((kind) => ({ params: { kind }, props: { kind } }));
}

type Props = InferGetStaticPropsType<typeof getStaticPaths>;

export const GET: APIRoute<Props> = ({ props }) =>
  Response.json(randomCards(getSiteData(), props.kind));
