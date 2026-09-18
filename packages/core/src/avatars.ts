import { setBotUserAvatar } from "@tgbox/db";
import { z } from "zod";
import type { CoreContext } from "./context.ts";

/** A user's photo is looked up again after this long, so a changed photo shows up within a week. */
export const AVATAR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Each refresh is three Telegram calls; this many fit one invocation with room for the rest. */
export const AVATAR_BATCH = 8;

export type AvatarBucket = Pick<R2Bucket, "put" | "delete">;

const Photos = z.object({
  ok: z.literal(true),
  result: z.object({
    photos: z.array(z.array(z.object({ file_id: z.string(), file_unique_id: z.string() }))),
  }),
});
const File = z.object({ ok: z.literal(true), result: z.object({ file_path: z.string() }) });

/**
 * R2 key of one photo of one user. The media bucket is public, so the key is a keyed hash: it
 * can't be derived from a user id by anyone without the secret, and a new photo gets a new key
 * (and with it a fresh cache entry).
 */
async function avatarKey(secret: string, tgUserId: number, photoId: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${tgUserId}:${photoId}`),
  );
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `users/${hex.slice(0, 32)}.jpg`;
}

/**
 * Fetches the current profile photo of each user (its smallest size, which is plenty for an
 * avatar), stores it in R2 and records the key; a user without a photo is recorded as such.
 * Failures leave the user as they were, to be tried on the next look.
 */
export async function refreshUserAvatars(
  ctx: CoreContext,
  input: {
    users: { tgUserId: number; avatarKey: string | null }[];
    media: AvatarBucket;
    secret: string;
  },
) {
  const token = ctx.config.BOT_TOKEN;
  if (!token) return;
  const api = (method: string, params: Record<string, string | number>) =>
    ctx.fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  for (const user of input.users.slice(0, AVATAR_BATCH)) {
    try {
      const photos = Photos.safeParse(
        await (await api("getUserProfilePhotos", { user_id: user.tgUserId, limit: 1 })).json(),
      );
      if (!photos.success) continue;
      const smallest = photos.data.result.photos[0]?.[0];
      let key: string | null = null;
      if (smallest) {
        key = await avatarKey(input.secret, user.tgUserId, smallest.file_unique_id);
        if (key !== user.avatarKey) {
          const file = File.safeParse(
            await (await api("getFile", { file_id: smallest.file_id })).json(),
          );
          if (!file.success) continue;
          const image = await ctx.fetch(
            `https://api.telegram.org/file/bot${token}/${file.data.result.file_path}`,
          );
          if (!image.ok) continue;
          await input.media.put(key, await image.arrayBuffer(), {
            // The key changes with the photo, so the object never does.
            httpMetadata: {
              contentType: "image/jpeg",
              cacheControl: "public, max-age=31536000, immutable",
            },
          });
        }
      }
      if (user.avatarKey && user.avatarKey !== key) await input.media.delete(user.avatarKey);
      await setBotUserAvatar(ctx.db, { tgUserId: user.tgUserId, avatarKey: key, now: ctx.now() });
    } catch (error) {
      console.error("avatar refresh failed", user.tgUserId, error);
    }
  }
}
