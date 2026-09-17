import { submitEntry } from "@tgbox/core";
import { SubmitRequest, type SubmitResult } from "@tgbox/shared";
import type { APIRoute } from "astro";
import { appJson, authenticateApp, jsonBody } from "@/lib/app-auth.ts";

export const prerender = false;

/**
 * Submits an entry for review. The rules (queue open, not listed, not pending, daily limit) live in
 * `@tgbox/core`'s `checkSubmission`, which the bot's `/submit` flow runs too — there is no second
 * copy of them here.
 */
export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateApp(request);
  if (!auth.ok) return auth.response;
  const { user, core } = auth.session;

  const input = SubmitRequest.safeParse(await jsonBody(request));
  if (!input.success) return appJson({ ok: false, error: "invalid" } satisfies SubmitResult);

  // The submitter is the verified Telegram user, never a field of the body.
  const result = await submitEntry(core, { ...input.data, tgUserId: user.id });
  return appJson(result satisfies SubmitResult);
};
