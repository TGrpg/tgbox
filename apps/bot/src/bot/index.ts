import { Bot } from "grammy";
import { admin } from "./admin.ts";
import { type BotDeps, type BotEnv, createApp } from "./app.ts";
import { chatMembers } from "./chat-members.ts";
import { friendLinks } from "./friend-links.ts";
import { guard } from "./guard.ts";
import { inlineSearch } from "./inline-search.ts";
import { payments } from "./payments.ts";
import { promote } from "./promote.ts";
import { review } from "./review.ts";
import { startHelp } from "./start-help.ts";
import { submit } from "./submit.ts";
import { supportGroup, supportRelay } from "./support.ts";
import { users } from "./users.ts";

export type { App, BotDeps, BotEnv } from "./app.ts";
export { createApp } from "./app.ts";
export { botCommands, setChatCommands } from "./commands.ts";

export function createBot(
  env: BotEnv,
  deps: BotDeps = { fetch: (input, init) => fetch(input, init) },
) {
  const app = createApp(env, deps);
  const bot = new Bot(env.BOT_TOKEN, {
    // Static bot info avoids a getMe call on every webhook request.
    botInfo: {
      id: Number(env.BOT_TOKEN.split(":")[0]),
      is_bot: true,
      first_name: "TGbox",
      username: env.BOT_USERNAME ?? "tgboxccbot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: true,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
    client: { fetch: deps.fetch },
  });

  // Order matters: review/admin/inline work for anyone they authorize; payments are recorded for
  // everyone who paid; the guard only fronts the private-chat promote and submit flows.
  // `supportGroup` runs before `admin` so `/ban` inside a support topic bans that topic's user, and
  // `supportRelay` runs last so it only sees private messages no other flow wanted. `users` records
  // private senders (blacklisted ones too, so the admin can find them) before any flow answers.
  // `bot.catch` only applies to long polling. For webhooks a thrown error becomes a 500 and Telegram
  // redelivers the update (e.g. forever for a user who blocked the bot), so log and answer 200.
  bot.errorBoundary(
    (error) => console.error("bot update failed", error.error),
    chatMembers(app),
    inlineSearch(app),
    payments(app),
    users(app),
    supportGroup(app),
    review(app),
    admin(app),
    guard(app),
    startHelp(app),
    promote(app),
    friendLinks(app),
    submit(app),
    supportRelay(app),
  );
  return bot;
}
