/**
 * Motion vocabulary shared by CSS (`--motion-*` vars in starwind.css) and the vanilla Motion layer.
 * Durations are in seconds (Motion's unit). Spring params are Kinetics-style
 * stiffness/damping/mass, turned into a duration + easing function that `motion/mini` renders as a
 * native `linear()` easing — the full spring generator would blow the page JS budget.
 */

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

export const springs = {
  /** Nav pill and indicators: quick, no visible wobble. */
  snappy: { stiffness: 420, damping: 36, mass: 1 },
  /** Card lift: a hint of overshoot. */
  lift: { stiffness: 320, damping: 22, mass: 1 },
  /** Press release: rebounds past rest once. */
  bouncy: { stiffness: 500, damping: 20, mass: 1 },
  /** Reveals and floating buttons. */
  gentle: { stiffness: 180, damping: 24, mass: 1 },
} satisfies Record<string, SpringParams>;

export const durations = { fast: 0.15, base: 0.22, slow: 0.4 };

/** ease-out-quint, matches `--ease-out-quint`. */
export const easeOut: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const reveal = { distance: 14, stagger: 0.045, maxStaggered: 10 };

const REST = 0.001;
const STEP = 1 / 120;
const MAX_SECONDS = 2;

/** Displacement from the target at time `t`, starting 1 away at rest (closed-form damped oscillator). */
function displacement({ stiffness, damping, mass }: SpringParams, t: number) {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    return (
      Math.exp(-zeta * omega * t) *
      (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t))
    );
  }
  if (zeta === 1) return Math.exp(-omega * t) * (1 + omega * t);
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * (zeta - root);
  const r2 = -omega * (zeta + root);
  return (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

export function springTransition(params: SpringParams) {
  let settled = STEP;
  for (let t = 0; t <= MAX_SECONDS; t += STEP) {
    if (Math.abs(displacement(params, t)) >= REST) settled = t + STEP;
  }
  const duration = Math.min(settled, MAX_SECONDS);
  const ease = (progress: number) =>
    progress <= 0 ? 0 : progress >= 1 ? 1 : 1 - displacement(params, progress * duration);
  return { duration, ease };
}
