import { describe, expect, test } from "vitest";
import { payMethods } from "./app-data.ts";

describe("payMethods", () => {
  test.each([
    [{ stars: true, usdt: true }, ["stars", "usdt"]],
    [{ stars: true, usdt: false }, ["stars"]],
    [{ stars: false, usdt: true }, ["usdt"]],
    [{ stars: false, usdt: false }, []],
  ])("offers only the enabled methods: %o", (payments, expected) => {
    expect(payMethods(payments)).toEqual(expected);
  });
});
