import { expect, test } from "vitest";
import { sparklinePoints } from "./sparkline.ts";

test("scales values into the box with the minimum at the bottom", () => {
  expect(sparklinePoints([10, 20, 15], 100, 20)).toBe("0,20 50,0 100,10");
});

test("a flat series is drawn through the middle", () => {
  expect(sparklinePoints([5, 5], 100, 20)).toBe("0,10 100,10");
});

test("fewer than two points draw nothing", () => {
  expect(sparklinePoints([5], 100, 20)).toBe("");
});
