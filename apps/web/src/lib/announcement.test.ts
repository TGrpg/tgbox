import { expect, test } from "vitest";
import { announcementKey } from "./announcement.ts";

const base = { zh: "收录机器人已上线", en: "Submission bot is live", href: "/enroll/" };

test("the dismissal key is stable for the same announcement", () => {
  expect(announcementKey({ ...base })).toBe(announcementKey(base));
  expect(announcementKey(base)).toMatch(/^announcement:[0-9a-z]+$/);
});

test.each([
  ["zh text", { ...base, zh: "收录机器人已升级" }],
  ["en text", { ...base, en: "Submission bot is back" }],
  ["link", { ...base, href: null }],
])("changing the %s gives a new dismissal key", (_, changed) => {
  expect(announcementKey(changed)).not.toBe(announcementKey(base));
});
