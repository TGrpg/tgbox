import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import {
  createDb,
  getCredentialCiphertext,
  listBotChats,
  listSettingsRows,
  putCredentialCiphertext,
  upsertBotChat,
  upsertSetting,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);

test("a setting writes once and an unchanged value writes nothing", async () => {
  expect((await upsertSetting(db, "site", '{"a":1}', NOW)).rowsWritten).toBeGreaterThan(0);
  expect(await upsertSetting(db, "site", '{"a":1}', NOW + 1)).toEqual({ rowsWritten: 0 });
  await upsertSetting(db, "site", '{"a":2}', NOW + 2);
  expect(await listSettingsRows(db)).toEqual([
    { key: "site", value: '{"a":2}', updatedAt: NOW + 2 },
  ]);
});

test("credentials are replaced in place", async () => {
  expect(await getCredentialCiphertext(db, "cryptopay_token")).toBeUndefined();
  await putCredentialCiphertext(db, "cryptopay_token", "iv.one", NOW);
  await putCredentialCiphertext(db, "cryptopay_token", "iv.two", NOW + 1);
  expect(await getCredentialCiphertext(db, "cryptopay_token")).toBe("iv.two");
});

test("bot chats are written only when membership details change", async () => {
  const chat = {
    chatId: "-1001",
    type: "supergroup" as const,
    title: "Review",
    username: null,
    status: "administrator",
    updatedAt: NOW,
  };
  expect((await upsertBotChat(db, chat)).rowsWritten).toBeGreaterThan(0);
  expect(await upsertBotChat(db, { ...chat, updatedAt: NOW + 1 })).toEqual({ rowsWritten: 0 });
  await upsertBotChat(db, { ...chat, status: "left", updatedAt: NOW + 2 });
  await upsertBotChat(db, { ...chat, chatId: "-1002", title: "Channel", type: "channel" });
  expect((await listBotChats(db)).map((row) => [row.chatId, row.status])).toEqual([
    ["-1001", "left"],
    ["-1002", "administrator"],
  ]);
});
