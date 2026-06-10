"use client";
/**
 * Centre Admin dashboard (§10.3) — live counts for THIS centre only.
 *
 * The Edge derives the centre from the session token (tier 1, same centre);
 * this page can neither name nor query any other centre. The "Answer bundles
 * held" tile is ciphertext only — there is no decrypt key on this side of the
 * boundary (INV-6), and the SealedBadge says so.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatCard, SealedBadge } from "@zuup/exam-ui";
import { fetchCounts, getToken, type CentreCounts } from "../lib/edge";

const POLL_MS = 5_000;

export default function CentreAdminDashboard() {
  const router = useRouter();
  const [counts, setCounts] = useState<CentreCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCounts(await fetchCounts());
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) return router.push("/login");
      setError((e as Error).message); // Edge unreachable → fail closed, keep last counts
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, router]);

  return (
    <main style={{ padding: "32px 28px", maxWidth: 1080, margin: "0 auto" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, letterSpacing: "0.04em" }}>
          CENTRE · ADMIN
        </h1>
        <p style={{ color: "#8b97a7", marginTop: 6, fontSize: 13 }}>
          Counts for this centre only · LAN-only · no internet
          {error && <span style={{ color: "#f85149" }}> · Edge unreachable: {error}</span>}
        </p>
      </header>

      {!counts ? (
        <p style={{ color: "#8b97a7" }}>Loading centre counts…</p>
      ) : (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 14,
          }}
        >
          <StatCard label="Invigilators ACTIVE" value={counts.invigilatorsActive} accent="ok" />
          <StatCard
            label="Invigilators pending"
            value={counts.invigilatorsPending}
            accent="warn"
            hint="approve in /approvals"
          />
          <StatCard label="Candidates registered" value={counts.candidatesRegistered} />
          <StatCard label="Checked-in / PRESENT" value={counts.present} />
          <StatCard label="Seated / IN_EXAM" value={counts.inExam} />
          <StatCard label="Submitted" value={counts.submitted} />
          <StatCard label="Seats AVAILABLE" value={counts.seatsAvailable} accent="ok" />
          <StatCard label="Seats ASSIGNED" value={counts.seatsAssigned} accent="warn" />
          <StatCard
            label="Answer bundles held"
            value={counts.bundlesHeld}
            accent="sealed"
            hint="ciphertext only"
          />
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <SealedBadge state="SEALED" />
      </section>
    </main>
  );
}
