import {
  type CredentialKey,
  getCredentialCiphertext,
  listSettingsRows,
  putCredentialCiphertext,
  upsertSetting,
} from "@tgbox/db";
import {
  BotSettings,
  PaymentSettings,
  type Settings,
  type SettingsKey,
  SiteSettings,
  settingsDefaults,
} from "@tgbox/shared";
import { audit } from "./audit.ts";
import { markDirtyAndDispatch } from "./build.ts";
import type { Actor, CoreContext } from "./context.ts";

/* ---------------------------------------------------------------- settings */

function storedValue(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// Stored fields override defaults, so a field added later gets its default instead of
// invalidating the whole row; a row that still fails validation falls back to the defaults.
function withDefaults<TValue extends object>(defaults: TValue, stored: unknown) {
  return typeof stored === "object" && stored !== null ? { ...defaults, ...stored } : defaults;
}

/** All settings in one query. Never throws on bad stored values. */
export async function getSettings(ctx: Pick<CoreContext, "db">): Promise<Settings> {
  const rows = await listSettingsRows(ctx.db);
  const stored = (key: SettingsKey) => storedValue(rows.find((row) => row.key === key)?.value);
  const bot = BotSettings.safeParse(withDefaults(settingsDefaults.bot, stored("bot")));
  const site = SiteSettings.safeParse(withDefaults(settingsDefaults.site, stored("site")));
  const payments = PaymentSettings.safeParse(
    withDefaults(settingsDefaults.payments, stored("payments")),
  );
  return {
    bot: bot.success ? bot.data : settingsDefaults.bot,
    site: site.success ? site.data : settingsDefaults.site,
    payments: payments.success ? payments.data : settingsDefaults.payments,
  };
}

export type SettingsUpdate =
  | { key: "bot"; value: BotSettings }
  | { key: "site"; value: SiteSettings }
  | { key: "payments"; value: PaymentSettings };

/** Replaces one settings key. The site announcement is baked into the static build. */
export async function updateSettings(
  ctx: CoreContext,
  input: SettingsUpdate & { actor: Actor },
): Promise<{ ok: true; changed: boolean } | { ok: false; error: "invalid" }> {
  const parsed =
    input.key === "bot"
      ? BotSettings.safeParse(input.value)
      : input.key === "site"
        ? SiteSettings.safeParse(input.value)
        : PaymentSettings.safeParse(input.value);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { rowsWritten } = await upsertSetting(
    ctx.db,
    input.key,
    JSON.stringify(parsed.data),
    ctx.now(),
  );
  const changed = rowsWritten > 0;
  if (changed) {
    await audit(ctx, input.actor, "settings.update", `settings:${input.key}`, parsed.data);
    if (input.key === "site") await markDirtyAndDispatch(ctx);
  }
  return { ok: true, changed };
}

/* ------------------------------------------------------------- credentials */

export class SettingsKeyMissingError extends Error {
  constructor() {
    super("SETTINGS_KEY is not configured");
    this.name = "SettingsKeyMissingError";
  }
}

async function credentialKey(ctx: CoreContext) {
  const secret = ctx.config.SETTINGS_KEY;
  if (!secret) throw new SettingsKeyMissingError();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** Encrypts and stores a third-party secret. The value itself is never audited. */
export async function setCredential(
  ctx: CoreContext,
  input: { key: CredentialKey; value: string; actor: Actor },
) {
  const key = await credentialKey(ctx);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(input.value),
    ),
  );
  const stored = `${toBase64(iv)}.${toBase64(ciphertext)}`;
  await putCredentialCiphertext(ctx.db, input.key, stored, ctx.now());
  await audit(ctx, input.actor, "credential.set", `credential:${input.key}`);
}

export async function hasCredential(ctx: CoreContext, key: CredentialKey) {
  return (await getCredentialCiphertext(ctx.db, key)) !== undefined;
}

/**
 * Decrypted secret, or null when unset or undecryptable (e.g. SETTINGS_KEY was rotated — the admin
 * must enter it again). Throws SettingsKeyMissingError when SETTINGS_KEY is not configured.
 */
export async function getCredential(ctx: CoreContext, key: CredentialKey) {
  const stored = await getCredentialCiphertext(ctx.db, key);
  if (stored === undefined) return null;
  const cryptoKey = await credentialKey(ctx);
  const [iv, data] = stored.split(".");
  if (!iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) },
      cryptoKey,
      fromBase64(data),
    );
    return new TextDecoder().decode(plain);
  } catch (error) {
    console.error("credential decrypt failed", key, error);
    return null;
  }
}
