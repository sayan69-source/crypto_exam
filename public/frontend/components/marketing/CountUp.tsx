"use client";

/**
 * Number that counts up when it first scrolls into view.
 *
 * Uses requestAnimationFrame with an ease-out curve rather than a fixed-step
 * interval, so the motion stays smooth and frame-rate independent.
 *
 * Degrades safely: under prefers-reduced-motion, or if the observer never
 * fires, the final value renders immediately — the number is content, not
 * decoration, so it must never be missing.
 */

import { useEffect, useRef, useState } from "react";

export default function CountUp({
  to,
  duration = 1400,
  className,
}: {
  to: number;
  duration?: number;
  className?: string;
}) {
  const [val, setVal] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || !el) { setVal(to); return; }

    let raf = 0;
    const run = () => {
      if (done.current) return;
      done.current = true;
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setVal(Math.round(eased * to));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { run(); io.disconnect(); } },
      { threshold: 0.4 }
    );
    io.observe(el);

    // If the observer cannot fire (hidden document, no compositing), show the
    // real number rather than leaving a blank stat on the page.
    const failsafe = setTimeout(() => { if (!done.current) { done.current = true; setVal(to); } }, 1200);

    return () => { io.disconnect(); cancelAnimationFrame(raf); clearTimeout(failsafe); };
  }, [to, duration]);

  return (
    <span ref={ref} className={className}>
      {val === null ? 0 : val}
    </span>
  );
}
