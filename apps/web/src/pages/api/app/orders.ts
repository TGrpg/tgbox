import { createOrder } from "@tgbox/core";
import { CreateOrderRequest, type CreateOrderResult } from "@tgbox/shared";
import type { APIRoute } from "astro";
import { appJson, authenticateApp, jsonBody } from "@/lib/app-auth.ts";

export const prerender = false;

/**
 * Starts a promotion purchase. Slot availability, the pin's target and the banner's content are all
 * decided by `@tgbox/core`'s `createOrder`, the same call the bot's `/promote` flow makes; payment
 * is attached afterwards by `/api/app/orders/<id>/pay`.
 */
export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateApp(request);
  if (!auth.ok) return auth.response;
  const { user, core } = auth.session;

  const input = CreateOrderRequest.safeParse(await jsonBody(request));
  if (!input.success) return appJson({ ok: false, error: "invalid" } satisfies CreateOrderResult);

  // The buyer is the verified Telegram user; a `tgUserId` in the body would be ignored.
  const result = await createOrder(core, { ...input.data, tgUserId: user.id });
  if (result.ok) return appJson({ ok: true, orderId: result.order.id } satisfies CreateOrderResult);
  return appJson(
    (result.error === "no_slots"
      ? { ok: false, error: result.error, nextFreeAt: result.nextFreeAt ?? undefined }
      : { ok: false, error: result.error }) satisfies CreateOrderResult,
  );
};
