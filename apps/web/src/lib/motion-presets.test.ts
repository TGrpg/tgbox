import { expect, test } from "vitest";
import { springs, springTransition } from "./motion-presets.ts";

test.each(Object.entries(springs))("%s spring starts at 0 and settles at 1", (_, params) => {
  const { duration, ease } = springTransition(params);
  expect(ease(0)).toBe(0);
  expect(ease(1)).toBe(1);
  expect(Math.abs(ease(0.95) - 1)).toBeLessThan(0.02);
  expect(duration).toBeGreaterThan(0.1);
  expect(duration).toBeLessThan(2);
});

function peak(ease: (progress: number) => number) {
  return Math.max(...Array.from({ length: 201 }, (_, index) => ease(index / 200)));
}

test("an underdamped spring overshoots its target; a critically damped one does not", () => {
  expect(peak(springTransition({ stiffness: 300, damping: 12, mass: 1 }).ease)).toBeGreaterThan(
    1.05,
  );
  const critical = 2 * Math.sqrt(300);
  expect(
    peak(springTransition({ stiffness: 300, damping: critical, mass: 1 }).ease),
  ).toBeLessThanOrEqual(1);
});

test("an overdamped spring rises monotonically", () => {
  const { ease } = springTransition({ stiffness: 100, damping: 60, mass: 1 });
  const samples = Array.from({ length: 101 }, (_, index) => ease(index / 100));
  for (let index = 1; index < samples.length; index++) {
    expect(samples[index] ?? 0).toBeGreaterThanOrEqual(samples[index - 1] ?? 0);
  }
});

test("stiffer springs settle faster", () => {
  const soft = springTransition({ stiffness: 120, damping: 20, mass: 1 });
  const stiff = springTransition({ stiffness: 500, damping: 40, mass: 1 });
  expect(stiff.duration).toBeLessThan(soft.duration);
});
