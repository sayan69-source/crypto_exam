/**
 * Demo seed for the Centre Admin portal (Phase 9 browser verification). Creates
 * one centre with an ACTIVE Centre Admin bound to an admin station, a few
 * invigilators (one pending approval), candidate enrolments, free seats, and a
 * couple of held (ciphertext) answer bundles for the blind-courier view.
 *
 * Idempotent: deletes the fixed demo centre (cascade) and re-inserts.
 *
 *   DATABASE_URL=… node src/seed-demo.ts
 */
import { makePool } from "./db.ts";
import { hashDob } from "./lib/dob.ts";
import { sealExam, deriveMasterSeed } from "./lib/question-seal.ts";

export const DEMO = {
  centreId: "11111111-1111-1111-1111-111111111111",
  examId: "44444444-4444-4444-4444-444444444444",
  adminId: "33333333-3333-3333-3333-333333333333",
  adminStationId: "22222222-2222-2222-2222-222222222222",
  adminBoundIp: "10.0.0.5",
  invigId: "66666666-6666-6666-6666-666666666666",
  invigStationId: "55555555-5555-5555-5555-555555555555",
  invigBoundIp: "10.0.0.6",
  demoSeatId: "77777777-7777-7777-7777-777777777777",
  // §13.5 tier-0: the System Admin is centre-less and bound to an HQ
  // workstation + fixed IP on the HQ WireGuard link (never the exam VLAN).
  sysAdminId: "99999999-9999-9999-9999-999999999999",
  hqStationId: "88888888-8888-8888-8888-888888888888",
  hqBoundIp: "172.16.0.10",
  // a second centre whose Centre Admin is still PENDING — feeds the tier-0 queue
  centre2Id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

const FAST = { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 };
const dummy = Buffer.from("aa".repeat(16), "hex");

async function main() {
  const pool = makePool(process.env.DATABASE_URL ?? "postgres://zuup:zuup@127.0.0.1:5433/zuup_edge");
  try {
    // Exam first: its cascade clears enrollments (incl. checked_in_by → staff
    // references, which have no ON DELETE action and would block the centre
    // delete's staff cascade otherwise).
    await pool.query(`DELETE FROM exams WHERE id = $1`, [DEMO.examId]); // cascade: enrollments, ledger rows
    await pool.query(`DELETE FROM centers WHERE id = $1`, [DEMO.centreId]); // cascade: terminals, staff…
    await pool.query(`DELETE FROM centers WHERE id = $1`, [DEMO.centre2Id]);
    await pool.query(`DELETE FROM staff_identities WHERE id = $1`, [DEMO.sysAdminId]); // centre-less; not cascaded
    // candidates from earlier seed runs are now enrolment-less orphans — drop them
    await pool.query(
      `DELETE FROM users WHERE role='CANDIDATE' AND id NOT IN (SELECT candidate_id FROM enrollments WHERE candidate_id IS NOT NULL)`,
    );
    await pool.query(`INSERT INTO centers (id, name, state, district) VALUES ($1,'DL-IITD','Delhi','New Delhi')`, [DEMO.centreId]);
    // Exam "in progress": T₀ already passed (candidates can decrypt) but the
    // window has NOT closed yet (so the egress gate stays shut until it does).
    await pool.query(
      `INSERT INTO exams (id, name, scheduled_at, duration_minutes, window_closes_at)
       VALUES ($1,'NEET 2026 · Slot 1', NOW() - INTERVAL '20 minutes', 180, NOW() + INTERVAL '160 minutes')`,
      [DEMO.examId],
    );

    // §10.7 — stage a REAL sealed question bundle (the Edge's keyless cache of
    // the public website's sealed paper). Sealed with a fixed public beacon so
    // a dev candidate can decrypt it immediately; t0_at is in the past.
    const beacon = Buffer.from("ab".repeat(32), "hex");
    const hkdfSalt = Buffer.from("cd".repeat(16), "hex");
    const PAPER = [
      { id: "Q1", subject: "Physics", prompt: "A body in uniform circular motion has constant…", options: ["velocity", "speed", "acceleration vector", "momentum"], answer_index: 1, marks: 4, negative: 1 },
      { id: "Q2", subject: "Physics", prompt: "SI unit of electric flux is…", options: ["V·m", "V/m", "C/m²", "N/C"], answer_index: 0, marks: 4, negative: 1 },
      { id: "Q3", subject: "Chemistry", prompt: "The pH of a 0.001 M HCl solution is…", options: ["1", "2", "3", "11"], answer_index: 2, marks: 4, negative: 1 },
      { id: "Q4", subject: "Chemistry", prompt: "Which has the highest first ionisation enthalpy?", options: ["Na", "Mg", "Al", "Si"], answer_index: 3, marks: 4, negative: 1 },
      { id: "Q5", subject: "Biology", prompt: "The powerhouse of the cell is the…", options: ["nucleus", "ribosome", "mitochondrion", "golgi body"], answer_index: 2, marks: 4, negative: 1 },
      { id: "Q6", subject: "Biology", prompt: "Humans typically have how many pairs of chromosomes?", options: ["21", "22", "23", "24"], answer_index: 2, marks: 4, negative: 1 },
    ];
    const master = await deriveMasterSeed(new Uint8Array(beacon), new Uint8Array(hkdfSalt), DEMO.examId);
    const bundle = await sealExam(DEMO.examId, PAPER, master);
    await pool.query(
      `INSERT INTO exam_question_bundle
         (exam_id, questions_root, bundle_cid, chain_tx, bundle_json, drand_round, hkdf_salt, t0_beacon, t0_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() - INTERVAL '20 minutes')`,
      [
        DEMO.examId,
        Buffer.from(bundle.questionsRoot, "hex"),
        "ipfs://b" + bundle.questionsRoot.slice(0, 32),
        "0xseed" + bundle.questionsRoot.slice(0, 8),
        JSON.stringify(bundle),
        4_100_000,
        hkdfSalt,
        beacon,
      ],
    );

    // ACTIVE Centre Admin bound to the admin station + a fixed LAN IP.
    await pool.query(
      `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, bound_ip, bound_terminal_id, status, activated_at)
       VALUES ($1,'CENTER_ADMIN',$2,'Priya Menon',$3,$3,$4,$5,'ACTIVE', NOW())`,
      [DEMO.adminId, DEMO.centreId, dummy, DEMO.adminBoundIp, DEMO.adminStationId],
    );
    await pool.query(
      `INSERT INTO terminals (id, center_id, seat_no, capability, wg_pubkey, bound_ip, state)
       VALUES ($1,$2,'ADM-1','ADMIN_STATION','wg-adm',$3,'AVAILABLE')`,
      [DEMO.adminStationId, DEMO.centreId, DEMO.adminBoundIp],
    );

    // §13.5 tier-0: ACTIVE System Admin (centre NULL) bound to the HQ
    // workstation + fixed HQ IP — the match-all login for the tier-0 portal.
    await pool.query(
      `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, bound_ip, bound_terminal_id, status, activated_at)
       VALUES ($1,'SYSTEM_ADMIN', NULL, 'HQ Controller', $2, $2, $3, $4, 'ACTIVE', NOW())`,
      [DEMO.sysAdminId, dummy, DEMO.hqBoundIp, DEMO.hqStationId],
    );

    // A second centre whose Centre Admin applicant is PENDING_APPROVAL — this
    // is what the System Admin sees in the §13.5 approval queue.
    await pool.query(`INSERT INTO centers (id, name, state, district) VALUES ($1,'MH-IITB','Maharashtra','Mumbai')`, [DEMO.centre2Id]);
    const caApplicant = (
      await pool.query(
        `INSERT INTO staff_identities (role, center_id, full_name, face_embedding_hash, fingerprint_template, bound_ip, status)
         VALUES ('CENTER_ADMIN',$1,'Neha Rao',$2,$2,'10.1.0.5','PENDING_APPROVAL') RETURNING id`,
        [DEMO.centre2Id, dummy],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO approval_requests (kind, applicant_identity_id, center_id, status)
       VALUES ('CENTER_ADMIN_REGISTRATION',$1,$2,'PENDING_APPROVAL')`,
      [caApplicant, DEMO.centre2Id],
    );

    // ACTIVE invigilator bound to a fixed invigilator station (for §9.1 login).
    await pool.query(
      `INSERT INTO terminals (id, center_id, seat_no, capability, wg_pubkey, bound_ip, state)
       VALUES ($1,$2,'INV-1','INVIGILATOR_STATION','wg-inv',$3,'AVAILABLE')`,
      [DEMO.invigStationId, DEMO.centreId, DEMO.invigBoundIp],
    );
    await pool.query(
      `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, bound_ip, bound_terminal_id, status, activated_at)
       VALUES ($1,'CENTER_INVIGILATOR',$2,'Arun Joshi',$3,$4,$5,$6,'ACTIVE', NOW())`,
      [DEMO.invigId, DEMO.centreId, dummy, dummy, DEMO.invigBoundIp, DEMO.invigStationId],
    );

    // Fixed-id candidate seat so one browser can play "the assigned seat".
    await pool.query(
      `INSERT INTO terminals (id, center_id, seat_no, capability, wg_pubkey, state)
       VALUES ($1,$2,'A-77','CANDIDATE_SEAT','wg-a-77','AVAILABLE')`,
      [DEMO.demoSeatId, DEMO.centreId],
    );

    // 13 more active invigilators (14 with Arun), 2 pending (with approval requests).
    for (let i = 0; i < 13; i++)
      await pool.query(`INSERT INTO staff_identities (role, center_id, full_name, face_embedding_hash, fingerprint_template, status) VALUES ('CENTER_INVIGILATOR',$1,$2,$3,$3,'ACTIVE')`, [DEMO.centreId, `Invigilator ${i + 1}`, dummy]);
    for (let i = 0; i < 2; i++) {
      const id = (await pool.query(`INSERT INTO staff_identities (role, center_id, full_name, face_embedding_hash, fingerprint_template, status) VALUES ('CENTER_INVIGILATOR',$1,$2,$3,$3,'PENDING_APPROVAL') RETURNING id`, [DEMO.centreId, `Applicant ${i + 1}`, dummy])).rows[0].id;
      await pool.query(`INSERT INTO approval_requests (kind, applicant_identity_id, center_id, status) VALUES ('INVIGILATOR_REGISTRATION',$1,$2,'PENDING_APPROVAL')`, [id, DEMO.centreId]);
    }

    // 487 candidates; mark 461 PRESENT.
    for (let i = 0; i < 487; i++) {
      const u = (await pool.query(`INSERT INTO users (role, full_name, dob_hash) VALUES ('CANDIDATE',$1,$2) RETURNING id`, [`Candidate ${i + 1}`, Buffer.from(hashDob("2005-01-01", FAST))])).rows[0].id;
      await pool.query(`INSERT INTO enrollments (candidate_id, exam_id, center_id, roll_number, status) VALUES ($1,$2,$3,$4,$5)`, [u, DEMO.examId, DEMO.centreId, `R-${1000 + i}`, i < 461 ? "PRESENT" : "ENROLLED"]);
    }

    // 33 available seats + 6 assigned + 1 down.
    for (let i = 0; i < 33; i++) await pool.query(`INSERT INTO terminals (center_id, seat_no, capability, wg_pubkey, state, health) VALUES ($1,$2,'CANDIDATE_SEAT',$3,'AVAILABLE','OK')`, [DEMO.centreId, `A-${i}`, `wg-a-${i}`]);
    for (let i = 0; i < 6; i++) await pool.query(`INSERT INTO terminals (center_id, seat_no, capability, wg_pubkey, state, health) VALUES ($1,$2,'CANDIDATE_SEAT',$3,'ASSIGNED','OK')`, [DEMO.centreId, `B-${i}`, `wg-b-${i}`]);
    await pool.query(`INSERT INTO terminals (center_id, seat_no, capability, wg_pubkey, state, health) VALUES ($1,'C-0','CANDIDATE_SEAT','wg-c-0','DOWN','FAULT')`, [DEMO.centreId]);

    // 3 held answer bundles (ciphertext only — blind courier).
    for (let i = 0; i < 3; i++)
      await pool.query(
        `INSERT INTO answer_ledger (center_id, exam_id, seat_no, leaf_index, leaf_hash, prev_root, chain_root, node_root_sig, ciphertext, iv, auth_tag, wrapped_dk)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$9)`,
        [
          DEMO.centreId, DEMO.examId, `A-${i}`, i,
          Buffer.from((i + 11).toString(16).padStart(2, "0").repeat(32), "hex"),
          Buffer.from((i === 0 ? "00" : (i + 10).toString(16).padStart(2, "0")).repeat(32), "hex"),
          Buffer.from((i + 20).toString(16).padStart(2, "0").repeat(32), "hex"),
          Buffer.from("5161".repeat(32), "hex"),
          Buffer.from("c1pherText".padEnd(64, "0")),
          Buffer.from("0123456789ab", "hex"),
        ],
      );

    console.log("seeded demo centre:", DEMO);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
