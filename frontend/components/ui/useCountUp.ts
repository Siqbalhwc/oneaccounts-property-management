import { useEffect, useRef, useState } from "react";

/**
 * Animates a number counting up from 0 to `target` whenever `target`
 * changes (e.g. once the real figure comes back from the API, or the user
 * switches the month dropdown). Used on the dashboard's KPI cards so a
 * number reads as "just computed live" rather than popping in already-set.
 *
 * Deliberately always restarts from 0 rather than animating from the
 * previous value -- for a KPI card that's the effect that reads as
 * intentional rather than a coincidental transition.
 */
export function useCountUp(target: number, durationMs = 750): number {
  const [value, setValue] = useState(0);
  const lastTarget = useRef<number | null>(null);

  useEffect(() => {
    if (lastTarget.current === target) return;
    lastTarget.current = target;

    // Respect a person's reduced-motion preference by jumping straight to
    // the final value instead of animating.
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }

    let raf = 0;
    const start = performance.now();
    function tick(now: number) {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
