import { entryKinds } from "@tgbox/shared";
import type { APIRoute, InferGetStaticPropsType } from "astro";
import { hotPool } from "@/lib/home.ts";
import { getSiteData } from "@/lib/site-data.ts";

export function getStaticPaths() {
  return entryKinds.map((kind) => ({ params: { kind }, props: { kind } }));
}

type Props = InferGetStaticPropsType<typeof getStaticPaths>;

/** Pool behind the home page "shuffle" buttons. */
export const GET: APIRoute<Props> = ({ props }) =>
  Response.json(hotPool(getSiteData().entries, props.kind));
