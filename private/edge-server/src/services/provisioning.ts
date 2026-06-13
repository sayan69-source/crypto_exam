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
}

export interface IngestCounts { centres: number; exams: number; candidates: number; staff: number }

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
  const counts: IngestCounts = { centres: 0, exams: 0, candidates: 0, staff: 0 };
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

    await client.query("COMMIT");
    return counts;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
