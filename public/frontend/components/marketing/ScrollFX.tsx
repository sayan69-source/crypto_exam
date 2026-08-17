"use client";

/**
 * Global scroll layer — mounted once in the root layout.
 *
 * Provides four things to EVERY route (previously only the homepage had any
 * scroll animation at all, via a local hook):
 *
 *   1. a reading-progress bar,
 *   2. a navbar that condenses once you leave the top of the page,
 *   3. a back-to-top control that appears after a screenful,
 *   4. a document-wide reveal observer that also picks up nodes added later
 *      (client-rendered lists, route changes) via a MutationObserver.
 *
 * Performance notes: the scroll handler is passive and coalesced into a single
 * requestAnimationFrame, and it only ever writes CSS custom properties /
 * classes — never layout-reading properties — so it cannot cause scroll jank.
 *
 * Accessibility: under prefers-reduced-motion the progress bar and back-to-top
 * still work (they are information and navigation, not decoration) but all
 * reveal animation is skipped and content renders plainly.
 */

import { useEffect, useRef, useState } from "react";

export default function ScrollFX() {
  const [progress, setProgress] = useState(0);
  const [showTop, setShowTop] = useState(false);
  // Resolved synchronously on the first client render. Defaulting to false
  // opened a window where content was tagged (and therefore hidden) before
  // the preference resolved — on a reduced-motion machine a redirect during
  // that window could leave text stuck at opacity 0.
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const ticking = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /* ── Progress bar · nav condense · back-to-top ──
     Coalesced with cancel-and-re-request rather than a "ticking" boolean.
     requestAnimationFrame is SUSPENDED while a document is hidden, so a
     boolean latch set before the rAF would never be cleared — leaving the
     whole scroll layer permanently dead once the tab was backgrounded
     mid-scroll. Replacing the pending frame self-heals instead: whatever is
     queued fires with current values as soon as the page is visible again. */
  useEffect(() => {
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      setProgress(max > 0 ? Math.min(Math.max(y / max, 0), 1) : 0);
      setShowTop(y > window.innerHeight * 0.9);
      document.body.classList.toggle("is-scrolled", y > 12);
      ticking.current = 0;
    };

    const onScroll = () => {
      if (ticking.current) cancelAnimationFrame(ticking.current);
      ticking.current = requestAnimationFrame(update);
    };

    // Returning to the tab re-syncs immediately, without waiting for a scroll.
    const onVisible = () => { if (!document.hidden) update(); };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (ticking.current) cancelAnimationFrame(ticking.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("visibilitychange", onVisible);
      document.body.classList.remove("is-scrolled");
    };
  }, []);

  /* ── Auto-reveal ──
     Only the marketing pages ever carried .reveal by hand, which left the
     ~50 portal/app pages with no scroll animation at all. Rather than tag
     every file, structural content is detected and tagged here.
     Item-level wins over block-level: a section containing cards lets the
     CARDS stagger in individually, and only a section with no such children
     animates as one block. */
  const autoTag = useRef<(() => void) | null>(null);

  useEffect(() => {
    const ITEM_SEL = [
      '[class*="card" i]', '[class*="Card" i]',
      '[class*="panel" i]', '[class*="tile" i]',
      '[class*="grid" i] > *', '[class*="Grid" i] > *',
      "tbody tr",
    ].join(",");
    const BLOCK_SEL = "main section, main > article, [class*='section' i]";

    // Never animate chrome, overlays, or anything the author opted out of.
    const EXCLUDE = [
      ".site-nav", ".site-footer", ".drawer", ".mega",
      ".cmdk-overlay", ".scroll-progress", ".to-top",
      "[role='dialog']", "[data-no-reveal]", "[aria-hidden='true']",
    ].join(",");

    const skip = (el: Element) => {
      if (el.closest(EXCLUDE)) return true;
      if (el.classList.contains("reveal")) return true;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.position === "sticky") return true;
      const r = el.getBoundingClientRect();
      // Ignore zero-size nodes and anything taller than the viewport — a huge
      // wrapper fading as one piece looks worse than not animating at all.
      if (r.height < 12 || r.height > window.innerHeight * 1.6) return true;
      return false;
    };

    const VARIANTS = ["reveal-rise", "reveal-left", "reveal-scale", "reveal-right"];

    const tag = () => {
      const tagged: Element[] = [];

      // 1. Items first, so their parent section defers to them.
      //    CSS-module names mean a card's own children often also contain
      //    "card" (cardIcon, cardTitle, cardBody…). Keep only the OUTERMOST
      //    match in each subtree, or every inner span animates separately.
      const raw = Array.from(document.querySelectorAll(ITEM_SEL)).filter((el) => !skip(el));
      const candidates = new Set(raw);
      const outermost = raw.filter((el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (candidates.has(p)) return false;
        }
        return true;
      });

      const groups = new Map<Element, Element[]>();
      outermost.forEach((el) => {
        const parent = el.parentElement;
        if (!parent) return;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent)!.push(el);
      });
      groups.forEach((items) => {
        items.forEach((el, i) => {
          el.classList.add("reveal", "reveal-item");
          (el as HTMLElement).style.setProperty("--i", String(Math.min(i, 8)));
          tagged.push(el);
        });
      });

      // 2. Blocks, but only where nothing inside is already animating.
      let vi = 0;
      document.querySelectorAll(BLOCK_SEL).forEach((el) => {
        if (skip(el)) return;
        if (el.querySelector(".reveal")) return;
        if (el.closest(".reveal")) return;
        el.classList.add("reveal", VARIANTS[vi++ % VARIANTS.length]);
        tagged.push(el);
      });

      // 3. Fallback. The portal pages are built from plain <div>s with hashed
      //    module class names and contain no <section> at all, so neither pass
      //    above reaches them. Descend through single-child wrappers to the
      //    real content column and stagger its children.
      if (tagged.length === 0) {
        let container: Element | null = document.querySelector("main") ?? document.body;
        while (container && container.children.length === 1) {
          container = container.children[0];
        }
        if (container) {
          Array.from(container.children).forEach((el, i) => {
            if (skip(el)) return;
            el.classList.add("reveal", "reveal-item");
            (el as HTMLElement).style.setProperty("--i", String(Math.min(i, 8)));
            tagged.push(el);
          });
        }
      }

      // 4. Anything already on screen shows immediately — animating
      //    above-the-fold content just flashes empty space on load.
      tagged.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.92) el.classList.add("in");
      });

      // 5. Per-element safety net. Hiding content and waiting for an observer
      //    is only safe if something ALWAYS un-hides it: a redirect, an
      //    unmounted observer or a backgrounded tab must never be able to
      //    strand text at opacity 0. Visibility wins over animation.
      tagged.forEach((el) => {
        window.setTimeout(() => el.classList.add("in"), 2000);
      });
    };

    autoTag.current = tag;
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const revealAll = () =>
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));

    if (reduced) {
      root.classList.add("reveal-ready");
      revealAll();
      return;
    }

    root.classList.add("reveal-ready");

    let fired = false;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          fired = true;
          e.target.classList.add("in");
          io.unobserve(e.target);
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -48px 0px" }
    );

    const observeAll = () => {
      autoTag.current?.();
      document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));
    };

    observeAll();

    // Most portal pages fetch their data after mount, so the first scan sees
    // an empty shell. A few scheduled re-scans cover that without depending
    // on mutation timing; they are idempotent (already-tagged nodes are
    // skipped) and stop after ~2s.
    const retries = [250, 700, 1500, 2500].map((ms) =>
      window.setTimeout(observeAll, ms)
    );

    // Routes render client-side too. Coalesce the re-scan — a mutation burst
    // must not trigger one pass per node.
    let pending = 0;
    const mo = new MutationObserver(() => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = 0; observeAll(); }, 150);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // If the observer can never report (backgrounded tab, no compositing),
    // show everything rather than leaving the page blank.
    const failsafe = setTimeout(() => { if (!fired) revealAll(); }, 1400);

    return () => {
      clearTimeout(failsafe);
      retries.forEach(clearTimeout);
      if (pending) clearTimeout(pending);
      mo.disconnect();
      io.disconnect();
    };
  }, [reduced]);

  /* ── Cursor spotlight on cards ──
     One delegated pointermove writes two custom properties on the card under
     the cursor; the glow itself is drawn entirely in CSS. Skipped on coarse
     pointers (no hover to track) and under reduced motion. */
  useEffect(() => {
    if (reduced) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let current: HTMLElement | null = null;
    const onMove = (e: PointerEvent) => {
      const card = (e.target as HTMLElement)?.closest?.(
        ".card, .cmdk-item, [data-spotlight]"
      ) as HTMLElement | null;
      if (card !== current) {
        current?.style.removeProperty("--spot");
        current = card;
      }
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
      card.style.setProperty("--spot", "1");
    };
    const onLeave = () => {
      current?.style.removeProperty("--spot");
      current = null;
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      current?.style.removeProperty("--spot");
    };
  }, [reduced]);

  return (
    <>
      <div
        className="scroll-progress"
        style={{ transform: `scaleX(${progress})` }}
        role="progressbar"
        aria-label="Page scroll progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      />

      <button
        type="button"
        className={`to-top${showTop ? " is-on" : ""}`}
        onClick={() =>
          window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })
        }
        aria-label="Back to top"
        tabIndex={showTop ? 0 : -1}
        aria-hidden={!showTop}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" strokeWidth="2.2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </>
  );
}
