// Regenerates the bot's Traditional dictionary: `pnpm --filter @tgbox/hant gen:bot`.
import { readFileSync, writeFileSync } from "node:fs";
import { botHantSource, botPaths } from "../src/bot-messages.ts";

writeFileSync(botPaths.hant, botHantSource(readFileSync(botPaths.zh, "utf8")));
console.log(`wrote ${botPaths.hant.pathname}`);
