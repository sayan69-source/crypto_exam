/**
 * Dev driver: run the full §9.5–§11.3 answer pipeline against a live Edge and
 * produce a real §13.4 sync bundle for the System Admin vault.
 *
 *   node --experimental-strip-types scripts/demo-answer-flow.mjs
 *
 * Steps (all real API calls, no shortcuts):
 *   1. invigilator match-all login (seeded station)
 *   2. biometric check-in of two candidates
 *   3. random seat auto-assignment for each (§9.6)
 *   4. candidate roll + DOB login at the assigned seat (§9.7)
 *   5. seal R (questions + responses) to the Edge's sealing key; submit (§11.2)
 *   6. Centre Admin login → blind-courier export (§13.4)
 *
 * Writes the export bundle to scripts/out/last-export.json (paste it into the
 * System Admin portal's Answer Vault). Clears the seed's placeholder ledger
 * rows first so the exported chain is wholly real.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { sealRecord } from "../private/edge-server/src/lib/envelope.ts";
import { toHex } from "../private/edge-server/src/lib/crypto.ts";

const EDGE = process.env.EDGE_URL ?? "http://127.0.0.1:4000";
const DB = process.env.DATABASE_URL ?? "postgres://zuup:zuup@127.0.0.1:5433/zuup_edge";

// seed-demo.ts fixtures
const CENTRE = "11111111-1111-1111-1111-111111111111";
const EXAM = "44444444-4444-4444-4444-444444444444";
const INVIG_STATION = "55555555-5555-5555-5555-555555555555";
const INVIG_IP = "10.0.0.6";
const ADMIN_STATION = "22222222-2222-2222-2222-222222222222";
const ADMIN_IP = "10.0.0.5";
const DOB = "2005-01-01";

async function api(path, { token, body, method } = {}) {
  const res = await fetch(`${EDGE}/api${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const probe = (terminalId, observedIp) => ({
  terminalId, observedIp, faceScore: 0.95, fpScore: 0.9, tpmValid: true, elapsedMs: 1200,
});

// §11.2 record R — the questions travel WITH the responses inside the seal.
const answerRecord = (roll, i) => ({
  exam_id: EXAM,
  subject_ref: `roll:${roll}`,
  responses: [
    {
      question_no: 1,
      question_text: "The dimension of Planck's constant equals that of:",
      options: { A: "energy", B: "angular momentum", C: "linear momentum", D: "power" },
      chosen_option: i % 2 === 0 ? "B" : "A",
      answered_at_ms: 1_000 + i,
      revision_count: 0,
    },
    {
      question_no: 2,
      question_text: "Which gas is evolved when dilute HCl reacts with zinc?",
      options: { A: "O2", B: "Cl2", C: "H2", D: "N2" },
      chosen_option: "C",
      answered_at_ms: 2_000 + i,
      revision_count: 1,
    },
  ],
  timing: { started: "2026-06-10T03:30:00Z", submitted: "2026-06-10T06:00:00Z" },
  anomaly_summary: { tab_switch: 0, face_fail: 0, multi_face: 0 },
});

async function main() {
  // 0 — clear the seed's placeholder ledger rows (garbage chain values).
  const pool = new pg.Pool({ connectionString: DB });
  const del = await pool.query(`DELETE FROM answer_ledger WHERE center_id = $1`, [CENTRE]);
  console.log(`0. cleared ${del.rowCount} placeholder ledger row(s) for the demo centre`);

  // free up seats from prior runs so assignment always finds one
  await pool.query(
    `UPDATE terminals SET state='AVAILABLE' WHERE center_id=$1 AND capability='CANDIDATE_SEAT' AND state IN ('ASSIGNED','ATTENDED','IN_EXAM','SUBMITTED')`,
    [CENTRE],
  );
  await pool.end();

  // 1 — invigilator match-all login
  const inv = await api("/invigilator/login", { body: probe(INVIG_STATION, INVIG_IP) });
  console.log("1. invigilator login ok");

  // sealing key (the System Admin PUBLIC half — the Edge holds no private key)
  const { pem } = await api("/exam/sealing-key");

  const rolls = ["R-1470", "R-1471"];
  for (const [i, roll] of rolls.entries()) {
    // 2 — biometric check-in (face + fp at the invigilator desk, §9.5)
    await api("/candidate/checkin", { token: inv.token, body: { examId: EXAM, roll, faceScore: 0.93, fpScore: 0.91 } });

    // 3 — random seat auto-assignment (§9.6)
    const seat = await api("/seat/assign", { token: inv.token, body: { examId: EXAM, roll } });
    console.log(`2-3. ${roll} checked in → seat ${seat.seatNo} (${seat.terminalId.slice(0, 8)}…)`);

    // 4 — candidate roll + DOB login AT THE ASSIGNED SEAT (§9.7, INV-5)
    await api("/candidate/login", { body: { terminalId: seat.terminalId, roll, dob: DOB } });

    // 5 — seal R to the System Admin key and submit (§11.2–§11.3)
    const sealed = sealRecord(answerRecord(roll, i), pem);
    const receipt = await api("/answer/submit", {
      body: {
        terminalId: seat.terminalId,
        ct: toHex(sealed.ct), iv: toHex(sealed.iv),
        tag: toHex(sealed.tag), wrappedDk: toHex(sealed.wrappedDk),
      },
    });
    console.log(`4-5. ${roll} sealed+submitted → leaf ${receipt.receipt.leafIndex}, root ${receipt.receipt.root.slice(0, 16)}…`);
  }

  // 6 — Centre Admin (blind courier) exports ciphertext-only bundle
  const adm = await api("/admin/login", { body: probe(ADMIN_STATION, ADMIN_IP) });
  const exp = await api("/admin/ledger/export", { token: adm.token, method: "POST" });
  console.log(`6. exported ${exp.exported} sealed record(s); manifest ${exp.bundle.manifestHash.slice(0, 16)}…`);

  const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "last-export.json");
  writeFileSync(outPath, JSON.stringify(exp.bundle, null, 2));
  console.log(`   bundle written to ${outPath} — paste into the System Admin vault`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
