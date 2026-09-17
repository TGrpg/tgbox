import { auditActions } from "@tgbox/core";
import { expect, test } from "vitest";
import { auditActionLabel, auditActionLabels } from "./labels.ts";

test("every audit action has a label; unknown actions fall back to the raw key", () => {
  expect(Object.keys(auditActionLabels).sort()).toEqual([...auditActions].sort());
  expect(auditActionLabel("tag.delete")).toBe("删除标签");
  expect(auditActionLabel("legacy.thing")).toBe("legacy.thing");
});
