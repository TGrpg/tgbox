import { env, waitUntil } from "cloudflare:workers";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import type { CoreContext } from "@tgbox/core";
import { createDb } from "@tgbox/db";
import { telegramInitData } from "@/lib/telegram.ts";
import { authenticate } from "./auth.ts";

/**
 * Required on every admin server function. The client half forwards the Mini App `initData`;
 * the server half authenticates the request and provides `actor` + a `@tgbox/core` context.
 */
export const adminMiddleware = createMiddleware({ type: "function" })
  .client(({ next }) => {
    const initData = telegramInitData();
    return next({ headers: initData ? { "X-Telegram-Init-Data": initData } : {} });
  })
  .server(async ({ next }) => {
    const auth = await authenticate(getRequest(), env);
    if (!auth) {
      setResponseStatus(401);
      throw new Error("Unauthorized");
    }
    const core: CoreContext = {
      db: createDb(env.DB),
      fetch: (input, init) => fetch(input, init),
      now: Date.now,
      config: { GITHUB_REPO: env.GITHUB_REPO, GITHUB_DISPATCH_TOKEN: env.GITHUB_DISPATCH_TOKEN },
      waitUntil,
    };
    return next({ context: { auth, core } });
  });
