// Fetches real t.me pages once and saves them as test fixtures.
// Run manually: `node packages/telegram/scripts/capture-fixtures.ts` (never from tests).
import { mkdir, writeFile } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const pages: { name: string; path: string }[] = [
  { name: "profile-channel", path: "/telegram" },
  { name: "channel-posts", path: "/s/telegram" },
  { name: "channel-first-post", path: "/s/telegram/1" },
  { name: "profile-group", path: "/grammyjs" },
  { name: "profile-bot", path: "/BotFather" },
  { name: "profile-user", path: "/nikolai" },
  { name: "profile-not-found", path: "/zzqq_not_exist_987654" },
  { name: "profile-banned", path: "/qassambrigades" },
  { name: "group-preview-redirect", path: "/s/grammyjs" },
];

const dir = new URL("../fixtures/", import.meta.url);
await mkdir(dir, { recursive: true });

for (const page of pages) {
  const res = await fetch(`https://t.me${page.path}`, {
    headers: { "user-agent": UA, "accept-language": "en" },
    redirect: "manual",
  });
  const body = await res.text();
  if (res.status >= 300 && res.status < 400) {
    const meta = { status: res.status, location: res.headers.get("location") };
    await writeFile(new URL(`${page.name}.json`, dir), `${JSON.stringify(meta, null, 2)}\n`);
  } else {
    await writeFile(new URL(`${page.name}.html`, dir), body);
  }
  console.log(page.name, res.status, body.length);
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
