import { env } from "cloudflare:workers";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { updateSettings } from "@tgbox/core";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";
import {
  CryptoPayTokenInput,
  loadSettingsView,
  SettingsInput,
  saveCryptoPayToken,
  saveTronGridKey,
} from "@/server/settings.ts";

const $getSettings = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(({ context }) => loadSettingsView(context.core, env));

export const settingsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => $getSettings({ signal }),
  });

/** Saves one settings key (one D1 row). */
export const $updateSettings = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(SettingsInput)
  .handler(({ data, context }) =>
    updateSettings(context.core, { ...data, actor: context.auth.actor }),
  );

export const $setCryptoPayToken = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(CryptoPayTokenInput)
  .handler(({ data, context }) =>
    saveCryptoPayToken(context.core, { token: data.token, actor: context.auth.actor }),
  );

export const $setTronGridKey = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(CryptoPayTokenInput)
  .handler(({ data, context }) =>
    saveTronGridKey(context.core, { token: data.token, actor: context.auth.actor }),
  );
