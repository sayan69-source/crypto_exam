"use client";

/**
 * Animated exam-lifecycle workflow.
 *
 * Replaces a static five-column timeline. The sequence auto-advances, a packet
 * travels the rail between stages, and the detail panel crossfades — so the
 * page shows the pipeline *running* rather than describing it.
 *
 * Motion is a progressive enhancement, never a requirement:
 *   • prefers-reduced-motion disables autoplay, the travelling packet and the
 *     pulse ring; the diagram becomes a plain, fully usable stepper.
 *   • Autoplay pauses on hover, on keyboard focus, and whenever the section is
 *     scrolled out of view (no invisible timers burning CPU).
 *   • Every stage is a real button: arrow keys and Tab both work.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./LucideIcon";
import s from "./WorkflowDiagram.module.css";

export type Stage = {
  icon: string;
  time: string;
  title: string;
  desc: string;
  detail: string;
  proof: string;
};

const STAGES: Stage[] = [
  {
    icon: "key-round",
    time: "PRE-EXAM",
    title: "Key ceremony",
    desc: "Custodians split the master key.",
    detail:
      "Independent custodians split the master key using Shamir's Secret Sharing. A quorum is required to reconstruct it, so no single party — including us — can open the paper early.",
    proof: "Shamir SSS · t-of-n quorum",
  },
  {
    icon: "file-lock-2",
    time: "AUTHORING",
    title: "Paper sealed",
    desc: "Encrypted at the moment of creation.",
    detail:
      "Setters compose the paper and it is encrypted immediately. A zero-knowledge proof certifies the difficulty distribution without revealing a single question.",
    proof: "AES-GCM-256 · Groth16 proof",
  },
  {
    icon: "link-2",
    time: "COMMIT",
    title: "Anchored on-chain",
    desc: "The hash goes public before the exam.",
    detail:
      "The question-set Merkle root is committed to Polygon before anyone sits down. The commitment is timestamped publicly, so the paper cannot be swapped afterwards.",
    proof: "SHA-256 Merkle root · Polygon PoS",
  },
  {
    icon: "satellite-dish",
    time: "T₀",
    title: "Beacon unseal",
    desc: "The key is released, not a second early.",
    detail:
      "At the exact scheduled moment, the decryption key is derived from a public drand randomness beacon. The timing is enforced by mathematics, not by an administrator.",
    proof: "drand beacon · HKDF derivation",
  },
  {
    icon: "search-check",
    time: "POST-EXAM",
    title: "Submit & verify",
    desc: "Anyone can audit any answer, forever.",
    detail:
      "Answers are sealed at the terminal and their Merkle root committed on-chain. Any candidate can verify their own submission from a block explorer, with no account and no trust in us.",
    proof: "Merkle inclusion proof · public",
  },
];

const ADVANCE_MS = 3200;

export default function WorkflowDiagram() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Defaults to true: the observer only ever PAUSES playback when the diagram
  // scrolls away. If it can never fire (backgrounded tab, no compositing) the
  // animation still runs rather than being silently disabled forever.
  const [inView, setInView] = useState(true);
  const [reduced, setReduced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Respect the OS-level motion preference, and react if it changes live.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Only run the timer while the diagram is actually on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setInView(e.isIntersecting),
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !playing || !inView) return;
    const t = setInterval(() => setActive((a) => (a + 1) % STAGES.length), ADVANCE_MS);
    return () => clearInterval(t);
  }, [reduced, playing, inView]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActive((a) => (a + 1) % STAGES.length);
      setPlaying(false);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => (a - 1 + STAGES.length) % STAGES.length);
      setPlaying(false);
    }
  }, []);

  const stage = STAGES[active];
  const pct = STAGES.length > 1 ? (active / (STAGES.length - 1)) * 100 : 0;
  const animate = !reduced;

  return (
    <div
      ref={rootRef}
      className={s.root}
      onMouseEnter={() => setPlaying(false)}
      onMouseLeave={() => setPlaying(true)}
      onFocusCapture={() => setPlaying(false)}
    >
      {/* ── Rail + nodes ── */}
      <div className={s.flow} onKeyDown={onKey}>
        <div className={s.rail} aria-hidden="true">
          <div className={s.railFill} style={{ width: `${pct}%` }} />
          {animate && inView && (
            <span key={active} className={s.packet} style={{ left: `${pct}%` }} />
          )}
        </div>

        <ol className={s.nodes} role="tablist" aria-label="Examination lifecycle">
          {STAGES.map((st, i) => {
            const isActive = i === active;
            const isDone = i < active;
            return (
              <li key={st.time} className={s.nodeItem}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="workflow-detail"
                  tabIndex={isActive ? 0 : -1}
                  className={[
                    s.node,
                    isActive ? s.nodeActive : "",
                    isDone ? s.nodeDone : "",
                  ].join(" ")}
                  onClick={() => { setActive(i); setPlaying(false); }}
                >
                  <span className={s.nodeDisc}>
                    <Icon name={isDone ? "check" : st.icon} size={20} strokeWidth={1.8} />
                    {isActive && animate && <span className={s.halo} aria-hidden="true" />}
                  </span>
                  <span className={s.nodeTime}>{st.time}</span>
                  <span className={s.nodeTitle}>{st.title}</span>
                  <span className={s.nodeDesc}>{st.desc}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── Detail panel ── */}
      <div className={s.detail} id="workflow-detail" role="tabpanel" aria-live="polite">
        <div key={active} className={s.detailInner}>
          <span className={s.detailIcon}>
            <Icon name={stage.icon} size={20} strokeWidth={1.8} />
          </span>
          <div className={s.detailBody}>
            <p className={s.detailStep}>
              Step {active + 1} of {STAGES.length} · {stage.time}
            </p>
            <h3 className={s.detailTitle}>{stage.title}</h3>
            <p className={s.detailText}>{stage.detail}</p>
            <p className={s.detailProof}>
              <Icon name="shield-check" size={13} strokeWidth={2} />
              {stage.proof}
            </p>
          </div>
        </div>

        {!reduced && (
          <button
            type="button"
            className={s.playBtn}
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause the walkthrough" : "Play the walkthrough"}
          >
            <Icon name={playing ? "pause" : "play"} size={14} strokeWidth={2.2} />
            {playing ? "Pause" : "Play"}
          </button>
        )}
      </div>
    </div>
  );
}
