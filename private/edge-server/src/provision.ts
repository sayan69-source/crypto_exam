/**
 * Commission a Centre Edge from a real HQ provisioning bundle (§12).
 *
 *   DATABASE_URL=… node src/provision.ts /path/to/centre-bundle.json
 *   node src/provision.ts --schema        # print the expected shape
 *
 * This replaces `seed-demo.ts`, which manufactured a centre: 487 invented
 * candidates all sharing one date of birth, staff rows with `dd`-repeated bytes
 * where a face template belongs, and a question paper sealed to a fixed beacon
 * so it could be decrypted at any time. That data was fine for a screenshot and
 * dangerous everywhere else — it is the kind of fixture that quietly becomes
 * the thing a deployment runs on, and it also hid the fact that the terminal
 * registry and the sealed-paper cache had NO real write path at all.
 *
 * There is no fallback and no built-in data: with no bundle, this exits
 * non-zero and the Edge serves an empty centre. An empty centre denies every
 * login, which is the correct state for a machine nobody has commissioned.
 *
 * The same `ingestBundle` runs behind `POST /api/provisioning/ingest`, so a
 * bundle applied here and one pushed over the HQ link converge on the same
 * rows — this is the offline door to the same room, for a centre being built
 * before it has an uplink.
 */
import { readFileSync } from "node:fs";
import { makePool } from "./db.ts";
import { loadConfig } from "./config.ts";
import { ingestBundle, type ProvisioningBundle } from "./services/provisioning.ts";

const SCHEMA = `
{
  "centre":   { "id": "<uuid>", "name": "…", "state": "…", "district": "…" },

  "exams":    [ { "id": "<uuid>", "name": "…",
                  "scheduled_at": "2026-05-03T09:00:00Z", "duration_minutes": 180 } ],

  "terminals":[ { "id": "<uuid>", "seat_no": "A-01",
                  "capability": "CANDIDATE_SEAT | INVIGILATOR_STATION | ADMIN_STATION",
                  "wg_pubkey": "<wireguard public key>",
                  "bound_ip": "10.0.0.21",
                  "golden_pcr": { "0": "<sha256 hex>", "4": "…", "7": "…",
                                  "8": "…", "9": "…", "14": "…" },
                  "ak_pubkey_pem":  "-----BEGIN PUBLIC KEY-----\\n…",
                  "bio_pubkey_pem": "-----BEGIN PUBLIC KEY-----\\n…" } ],

  "staff":    [ { "id": "<uuid>", "role": "CENTER_ADMIN | CENTER_INVIGILATOR",
                  "full_name": "…", "face_hash": "<hex>", "fingerprint": "<hex>",
                  "status": "ACTIVE | PENDING_APPROVAL" } ],

  "candidates": [ { "id": "<uuid>", "full_name": "…", "dob": "2005-03-14",
                    "roll_number": "…", "exam_id": "<uuid>",
                    "face_hash": "<hex>", "fingerprint": "<hex>",
                    "status": "ENROLLED" } ],

  "question_bundles": [ { "exam_id": "<uuid>", "questions_root": "<32-byte hex>",
                          "bundle_cid": "ipfs://…", "chain_tx": "0x…",
                          "bundle": { "items": [ … ] },
                          "drand_round": 4100000, "hkdf_salt": "<hex>",
                          "t0_at": "2026-05-03T09:00:00Z" } ]
}

Notes
  • golden_pcr / ak_pubkey_pem / bio_pubkey_pem are what make a terminal able to
    attest and to log anyone in. A terminal without them boots to a locked Gate.
  • Only PUBLIC key material appears here. The Edge never holds a private key.
  • Everything UPSERTs on its id, so re-running converges instead of duplicating.
  • t0_beacon is optional and deliberately withheld until T₀; a bundle staged
    with one is decryptable the moment it lands.
`;

function fail(message: string): never {
  console.error(`provision: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? process.env.EDGE_PROVISIONING_BUNDLE;
  if (arg === "--schema" || arg === "-s") {
    console.log(SCHEMA.trim());
    return;
  }
  if (!arg) {
    fail(
      "no bundle given.\n" +
        "  usage: node src/provision.ts <centre-bundle.json>   (or set EDGE_PROVISIONING_BUNDLE)\n" +
        "         node src/provision.ts --schema\n" +
        "  This Edge stays empty until a real centre bundle is applied — an empty\n" +
        "  centre denies every login, which is correct for an uncommissioned machine.",
    );
  }

  let bundle: ProvisioningBundle;
  try {
    bundle = JSON.parse(readFileSync(arg, "utf8")) as ProvisioningBundle;
  } catch (e) {
    fail(`could not read ${arg}: ${(e as Error).message}`);
  }
  if (!bundle?.centre?.id || !bundle.centre.name) fail("bundle has no centre { id, name }");

  const config = loadConfig();
  const pool = makePool(config.databaseUrl);
  try {
    const counts = await ingestBundle(pool, config, bundle);
    console.log(
      `provisioned ${bundle.centre.name} (${bundle.centre.id}):\n` +
        `  exams ${counts.exams} · candidates ${counts.candidates} · staff ${counts.staff}\n` +
        `  terminals ${counts.terminals} · sealed papers ${counts.questionBundles}`,
    );
    // Say it plainly rather than leaving an estate that cannot boot look fine.
    const unattestable = (bundle.terminals ?? []).filter((t) => !t.golden_pcr || !t.ak_pubkey_pem);
    if (unattestable.length) {
      console.warn(
        `\nWARNING: ${unattestable.length} terminal(s) have no golden PCR set or no attestation key.\n` +
          `They cannot attest, so they will HALT at boot and no one can log in on them:\n` +
          unattestable.map((t) => `  - ${t.seat_no} (${t.id})`).join("\n"),
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => fail(String((e as Error).stack ?? e)));
