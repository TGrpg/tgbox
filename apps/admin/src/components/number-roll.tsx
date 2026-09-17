import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";

/** A number that rolls up from its previous value. */
export function NumberRoll({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(reduce ? value : 0);
  const text = useTransform(motionValue, (latest) => Math.round(latest).toLocaleString("zh-CN"));

  useEffect(() => {
    if (reduce) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [motionValue, reduce, value]);

  return <motion.span className="tabular-nums">{text}</motion.span>;
}
