/**
 * Marks a page as a walkthrough rather than the live system.
 *
 * The candidate exam-taking screens on this public site are a demonstration:
 * a real candidate never sits an exam here. They are verified biometrically at
 * an accredited centre and take the paper on a sealed ZUUP-OS terminal, on a
 * network with no route to the internet — the backend enforces this, returning
 * 403 "Candidates do not log in online" to anyone who tries.
 *
 * Without this label those screens are indistinguishable from the real thing,
 * which is the one impression a system built on "verify, do not trust" cannot
 * afford to leave.
 */
export default function DemoBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '11px 16px',
        margin: '0 0 18px',
        borderRadius: 10,
        border: '1px solid rgba(217, 119, 6, 0.35)',
        background: 'rgba(217, 119, 6, 0.10)',
        color: '#B45309',
        fontSize: 12.5,
        lineHeight: 1.6,
      }}
    >
      <span aria-hidden style={{ fontWeight: 700 }}>◆</span>
      <span>
        <strong>Walkthrough.</strong>{' '}
        {children ?? (
          <>
            This shows what a candidate sees. Real examinations do not run here — they run
            on a sealed terminal at an accredited centre, offline, after a biometric check.
          </>
        )}
      </span>
    </div>
  );
}
