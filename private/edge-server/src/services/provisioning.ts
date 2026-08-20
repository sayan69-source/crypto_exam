/**
 * HQ → Edge pre-exam provisioning ingest (§12).
 *
 * BEFORE exam day, while the centre still has an uplink, HQ pushes this centre's
 * enrolment bundle — candidates (roll + DOB hash + face/finger templates) and
 * centre staff — into the local Edge DB. From then on the centre can run the
 * whole exam OFFLINE: every login + biometric check is answered locally against
 * these rows, with no internet for anyone (INV-3). Raw biometrics never travel;
 * only DPDP-safe hashes/templates do.
 *
 * Idempotent: every row UPSERTs on its UUID, so re-running a sync (e.g. after a
 * late registration) converges instead of duplicating.
 */
import type pg from "pg";
import { hashDob } from "../lib/dob.ts";
import type { EdgeConfig } from "../config.ts";

export interface ProvisioningBundle {
  centre: { id: string; name: string; state?: string | null; district?: string | null };
  exams?: { id: string; name: string; scheduled_at: string; duration_minutes?: number }[];
  candidates?: {
    id: string; full_name: string; dob: string; face_hash?: string | null;
    fingerprint?: string | null; roll_number: string; exam_id: string; status?: string;
  }[];
  staff?: {
    id: string; role: string; full_name: string; face_hash?: string | null;
    fingerprint?: string | null; status?: string;
  }[];
  /**
   * The centre's commissioned machines (§7.1). This is the ONLY path that fills
   * the terminal registry, and it exists because the registry was previously
   * unfillable: `terminals.golden_pcr` was documented as a commissioning input
   * but no API, ingest or tool ever wrote it, so `attestTerminal` compared every
   * quote against NULL, every privileged login died on TPM_ATTESTATION_INVALID,
   * and `zuup-attest.sh` read the same denial as "not the golden image" and
   * powered the machine off. An estate that cannot be commissioned cannot boot.
   *
   * Every field here is a PUBLIC value produced at commissioning: the WireGuard
   * public key, the TPM Attestation Key public half, the biometric daemon's
   * signing public half, and the golden PCR digests. No secret crosses this link.
   */
  terminals?: {
    id: string;
    seat_no: string;
    capability: "CANDIDATE_SEAT" | "INVIGILATOR_STATION" | "ADMIN_STATION";
    wg_pubkey: string;
    /** Fixed LAN address this machine is bound to; the Edge checks the socket. */
    bound_ip?: string | null;
    /** {"<pcr index>": "<sha256 hex>"} — what the machine measured at enrolment. */
    golden_pcr?: Record<string, string> | null;
    /**
     * {"<pcr index>": "<sha256 hex>"} — what the AUTHORITY computed the signed
     * UKI must measure (`systemd-measure` over the exact cmdline provisioning
     * signed for this terminal). Outranks `golden_pcr` for the indices it
     * names, which is what stops a terminal enrolled while already compromised
     * from vouching for its own image. See migration 006.
     */
    predicted_pcr?: Record<string, string> | null;
    ak_pubkey_pem?: string | null;
    bio_pubkey_pem?: string | null;
  }[];
  /**
   * The SEALED, KEYLESS question bundles for this centre's exams (§10.7).
   *
   * Ciphertext + Merkle proofs only: no key travels this link, and nothing here
   * is readable before the T₀ beacon is released. Staging it before exam day is
   * what lets the centre run with no internet at all on the day (INV-3) — and,
   * like the terminal registry, it had no path in until now: only the demo seed
   * ever wrote this table, so a real deployment had nothing to serve.
   */
  /**
   * The paper's SHAPE for each exam (services/exam_pattern.ExamPattern).
   *
   * The public side began sending these and this interface did not name them,
   * so they were silently dropped — and a terminal with the questions but not
   * the pattern can only assume four-option MCQ, which renders a numeric-entry
   * section as multiple choice rather than failing visibly.
   *
   * Carries no secret: a pattern states that there are twenty questions worth
   * +4/-1, never what any of them asks.
   */
  exam_patterns?: {
    exam_id: string;
    pattern: unknown;
    total_questions?: number;
    duration_minutes?: number;
  }[];
  question_bundles?: {
    exam_id: string;
    /** 32-byte Merkle root, hex — the value committed on-chain. */
    questions_root: string;
    bundle_cid?: string | null;
    chain_tx?: string | null;
    /** The keyless SealedBundle as the website produced it. */
    bundle: unknown;
    drand_round?: number;
    /** Public HKDF salt for the master seed, hex. */
    hkdf_salt: string;
    /** The instant the beacon may be served (ISO 8601). */
    t0_at: string;
    /** The drand beacon, hex. Withhold until T₀ if it is not yet public. */
    t0_beacon?: string | null;
  }[];
}

export interface IngestCounts {
  centres: number; exams: number; candidates: number; staff: number;
  terminals: number; bundles: number; patterns: number;
}

const hx = (h?: string | null): Buffer | null => (h ? Buffer.from(h, "hex") : null);
// staff_identities.face_embedding_hash / fingerprint_template are NOT NULL; a
// staff member who hasn't enrolled a finger yet gets an explicit ENROL-PENDING
// marker that can never match a live finger (fail-closed, §8.1).
const ENROL_PENDING = Buffer.from("00".repeat(32), "hex");

export async function ingestBundle(
  pool: pg.Pool,
  cfg: EdgeConfig,
  b: ProvisioningBundle,
): Promise<IngestCounts> {
  const counts: IngestCounts = {
    centres: 0, exams: 0, candidates: 0, staff: 0, terminals: 0, bundles: 0, patterns: 0,
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO centers (id, name, state, district) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, state=EXCLUDED.state, district=EXCLUDED.district`,
      [b.centre.id, b.centre.name, b.centre.state ?? null, b.centre.district ?? null],
    );
    counts.centres = 1;

    for (const e of b.exams ?? []) {
      await client.query(
        `INSERT INTO exams (id, name, scheduled_at, duration_minutes) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, scheduled_at=EXCLUDED.scheduled_at,
           duration_minutes=EXCLUDED.duration_minutes`,
        [e.id, e.name, e.scheduled_at, e.duration_minutes ?? 180],
      );
      counts.exams++;
    }

    for (const c of b.candidates ?? []) {
      const dobHash = Buffer.from(hashDob(c.dob, cfg.argon));
      await client.query(
        `INSERT INTO users (id, role, full_name, enrolled_photo_hash, dob_hash, fingerprint_template)
         VALUES ($1,'CANDIDATE',$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name,
           enrolled_photo_hash=EXCLUDED.enrolled_photo_hash, dob_hash=EXCLUDED.dob_hash,
           fingerprint_template=EXCLUDED.fingerprint_template`,
        [c.id, c.full_name, hx(c.face_hash), dobHash, hx(c.fingerprint)],
      );
      await client.query(
        `INSERT INTO enrollments (candidate_id, exam_id, center_id, roll_number, status)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (candidate_id, exam_id) DO UPDATE SET center_id=EXCLUDED.center_id,
           roll_number=EXCLUDED.roll_number, status=EXCLUDED.status`,
        [c.id, c.exam_id, b.centre.id, c.roll_number, c.status ?? "ENROLLED"],
      );
      counts.candidates++;
    }

    for (const s of b.staff ?? []) {
      await client.query(
        `INSERT INTO staff_identities
           (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, center_id=EXCLUDED.center_id,
           full_name=EXCLUDED.full_name, face_embedding_hash=EXCLUDED.face_embedding_hash,
           fingerprint_template=EXCLUDED.fingerprint_template, status=EXCLUDED.status`,
        [s.id, s.role, b.centre.id, s.full_name, hx(s.face_hash) ?? ENROL_PENDING,
         hx(s.fingerprint) ?? ENROL_PENDING, s.status ?? "PENDING_APPROVAL"],
      );
      counts.staff++;
    }

    for (const t of b.terminals ?? []) {
      // Commissioning fields only. `state` and `health` are LIVE columns owned by
      // the exam floor — a re-sync during a session must not reset a seat that is
      // mid-exam back to AVAILABLE and strand a candidate.
      await client.query(
        `INSERT INTO terminals
           (id, center_id, seat_no, capability, wg_pubkey, bound_ip, golden_pcr,
            predicted_pcr, ak_pubkey_pem, bio_pubkey_pem)
         VALUES ($1,$2,$3,$4::terminal_cap,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           center_id=EXCLUDED.center_id, seat_no=EXCLUDED.seat_no,
           capability=EXCLUDED.capability, wg_pubkey=EXCLUDED.wg_pubkey,
           bound_ip=EXCLUDED.bound_ip, golden_pcr=EXCLUDED.golden_pcr,
           predicted_pcr=EXCLUDED.predicted_pcr,
           ak_pubkey_pem=EXCLUDED.ak_pubkey_pem, bio_pubkey_pem=EXCLUDED.bio_pubkey_pem`,
        [
          t.id, b.centre.id, t.seat_no, t.capability, t.wg_pubkey, t.bound_ip ?? null,
          t.golden_pcr ? JSON.stringify(t.golden_pcr) : null,
          t.predicted_pcr ? JSON.stringify(t.predicted_pcr) : null,
          t.ak_pubkey_pem ?? null, t.bio_pubkey_pem ?? null,
        ],
      );
      counts.terminals++;
    }

    for (const p of b.exam_patterns ?? []) {
      // The exam row already exists from the `exams` loop above; this only adds
      // its shape. UPDATE rather than upsert so a pattern for an exam this
      // centre is not running cannot conjure an exam row.
      await client.query(
        `UPDATE exams SET pattern = $2, total_questions = $3 WHERE id = $1`,
        [p.exam_id, JSON.stringify(p.pattern), p.total_questions ?? null],
      );
      counts.patterns++;
    }

    for (const q of b.question_bundles ?? []) {
      await client.query(
        `INSERT INTO exam_question_bundle
           (exam_id, questions_root, bundle_cid, chain_tx, bundle_json, drand_round, hkdf_salt, t0_beacon, t0_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (exam_id) DO UPDATE SET
           questions_root=EXCLUDED.questions_root, bundle_cid=EXCLUDED.bundle_cid,
           chain_tx=EXCLUDED.chain_tx, bundle_json=EXCLUDED.bundle_json,
           drand_round=EXCLUDED.drand_round, hkdf_salt=EXCLUDED.hkdf_salt,
           -- A beacon already released is never un-released by a re-sync: seats
           -- mid-paper would lose the seed their questions were opened with.
           t0_beacon=COALESCE(exam_question_bundle.t0_beacon, EXCLUDED.t0_beacon),
           t0_at=EXCLUDED.t0_at`,
        [
          q.exam_id, hx(q.questions_root), q.bundle_cid ?? null, q.chain_tx ?? null,
          JSON.stringify(q.bundle), q.drand_round ?? 0, hx(q.hkdf_salt),
          q.t0_beacon ? hx(q.t0_beacon) : null, q.t0_at,
        ],
      );
      counts.bundles++;
    }

    await client.query("COMMIT");
    return counts;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
