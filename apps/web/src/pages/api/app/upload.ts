import { env } from "cloudflare:workers";
import { getOrder, setOrderBanner } from "@tgbox/db";
import type { UploadResult } from "@tgbox/shared";
import type { APIRoute } from "astro";
import { appError, appJson, authenticateApp } from "@/lib/app-auth.ts";

export const prerender = false;

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * The banner image of a pending order. The R2 key is the order id, so the order has to exist first
 * — the same order the bot's `/promote` flow uploads for, written to the same bucket and key.
 *
 * A day of cache, not a year: the key carries no version and the buyer may replace the image while
 * the order is still pending (see `.agents/cloudflare.md`).
 */
export const POST: APIRoute = async ({ request, url }) => {
  const auth = await authenticateApp(request);
  if (!auth.ok) return auth.response;
  const { user, db } = auth.session;

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  // The contract names only the `image` field, but the key is `promos/<order id>.jpg`, so the
  // order has to be named too: as a form field, or in the query string.
  const orderId = Number(form?.get("orderId") ?? url.searchParams.get("orderId"));
  if (!(image instanceof File)) return appError("invalid");
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return appError("not_found", 404);
  if (!IMAGE_TYPES.has(image.type)) return appError("unsupported_type");
  if (image.size === 0 || image.size > MAX_BYTES) return appError("too_large");

  const order = await getOrder(db, orderId);
  if (!order || order.tgUserId !== user.id) return appError("not_found", 404);
  if (order.status !== "pending" || order.kind !== "banner" || !order.banner) {
    return appError("order_expired");
  }

  const key = `promos/${order.id}.jpg`;
  const imageUrl = `${env.R2_PUBLIC_URL}/${key}`;
  try {
    await env.MEDIA.put(key, await image.arrayBuffer(), {
      httpMetadata: { contentType: image.type, cacheControl: "public, max-age=86400" },
    });
  } catch (error) {
    console.error("banner image upload failed", order.id, error);
    return appError("upload_failed", 502);
  }
  await setOrderBanner(db, order.id, { ...order.banner, imageUrl });
  return appJson({ ok: true, imageUrl } satisfies UploadResult);
};
