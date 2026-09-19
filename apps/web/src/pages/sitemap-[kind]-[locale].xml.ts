import { entryKinds, siteLocales } from "@tgbox/shared";
import type { APIRoute, InferGetStaticPropsType } from "astro";
import { kindSitemap } from "@/lib/sitemap.ts";

export function getStaticPaths() {
  return entryKinds.flatMap((kind) =>
    siteLocales.map((locale) => ({ params: { kind, locale }, props: { kind, locale } })),
  );
}

type Props = InferGetStaticPropsType<typeof getStaticPaths>;

export const GET: APIRoute<Props> = ({ props }) => kindSitemap(props.kind, props.locale);
