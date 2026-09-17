import { setUserLocale } from "@tgbox/db";
import { PrefsRequest, type PrefsResult } from "@tgbox/shared";
import type { APIRoute } from "astro";
import { appError, appJson, authenticateApp, jsonBody } from "@/lib/app-auth.ts";

export const prerender = false;

/**
 * Stores the app language. The same row the bot's `/lang` writes, so the two agree, and the same
 * conditional upsert: choosing the language you already have costs zero rows written.
 */
export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateApp(request);
  if (!auth.ok) return auth.response;
  const { user, db } = auth.session;

  const input = PrefsRequest.safeParse(await jsonBody(request));
  if (!input.success) return appError("invalid");

  await setUserLocale(db, user.id, input.data.locale, Date.now());
  return appJson({ ok: true } satisfies PrefsResult);
};
