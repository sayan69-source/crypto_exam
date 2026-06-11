/// <reference lib="dom" />
// ^ the terminal decryptor (question-crypto.ts) is browser code and uses the DOM
//   type BufferSource; this reference lets the edge Node typecheck resolve it for
//   this cross-import. At runtime node:test strips types, so nothing DOM is used.
/**
 * Cross-implementation proof: a bundle sealed by the Edge sealer
 * (lib/question-seal.ts) is verified against its root AND lazily decrypted,
 * unchanged, by the TERMINAL's own decryptor (exam-terminal/lib/question-
 * crypto.ts) — the two share no code, only the published §10.7 wire format.
 *
 * This is the question-side analogue of seal-compat.test.ts (answers). If it
 * passes, the LAN delivery pipeline is real: whatever the Edge serves, the
 * candidate terminal can open at T₀ and no tampered question can render.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sealExam, deriveMasterSeed } from "../lib/question-seal.ts";
import {
  deriveMasterSeed as tDeriveSeed,
  openQuestion,
  verifyBundleAgainstRoot,
  QuestionIntegrityError,
  type SealedBundle as TBundle,
  type SealedItem as TItem,
} from "../../../exam-terminal/lib/question-crypto.ts";

// The edge sealer and the terminal decryptor declare structurally-identical but
// nominally-distinct SealedBundle/SealedItem types (they share no code — only
// the wire format). These bridges make the cross-call explicit; the whole point
// of this test is that the BYTES interoperate even though the types are separate.
const asTBundle = (b: unknown) => b as TBundle;
const asTItem = (i: unknown) => i as TItem;

const hex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));

const EXAM = "44444444-4444-4444-4444-444444444444";
const BEACON = "ab".repeat(32); // public drand beacon (hex)
const SALT = "cd".repeat(16);   // public HKDF salt (hex)
const PAPER = [
  { id: "Q1", prompt: "2 + 2 = ?", options: ["3", "4", "5"], answer_index: 1 },
  { id: "Q2", prompt: "Capital of Japan?", options: ["Osaka", "Kyoto", "Tokyo"], answer_index: 2 },
  { id: "Q3", prompt: "H2O is?", options: ["Water", "Salt", "Gold"], answer_index: 0 },
  { id: "Q4", prompt: "Largest planet?", options: ["Earth", "Jupiter", "Mars"], answer_index: 1 },
  { id: "Q5", prompt: "Speed of light approx (km/s)?", options: ["3e5", "3e3", "3e8"], answer_index: 0 },
];

test("Edge-sealed bundle verifies + decrypts with the terminal decryptor (§10.7)", async () => {
  const master = await deriveMasterSeed(hex(BEACON), hex(SALT), EXAM);
  const bundle = await sealExam(EXAM, PAPER, master);

  // 1) the terminal derives the SAME master seed from the public beacon
  const tMaster = await tDeriveSeed(BEACON, SALT, EXAM);
  assert.deepEqual([...tMaster], [...master], "master seed agreement");

  // 2) the terminal accepts the whole bundle against its root (all proofs valid)
  assert.equal(await verifyBundleAgainstRoot(asTBundle(bundle), bundle.questionsRoot), true);

  // 3) every question opens to its exact plaintext, lazily, in any order
  for (const it of [...bundle.items].reverse()) {
    const q = await openQuestion(asTItem(it), tMaster, EXAM, bundle.questionsRoot);
    const src = PAPER.find((p) => p.id === it.question_id)!;
    assert.equal(q.prompt, src.prompt);
    assert.deepEqual(q.options, src.options);
  }
});

test("a tampered ciphertext is refused before render (integrity, INV-9 surface)", async () => {
  const master = await deriveMasterSeed(hex(BEACON), hex(SALT), EXAM);
  const bundle = await sealExam(EXAM, PAPER, master);
  const tMaster = await tDeriveSeed(BEACON, SALT, EXAM);

  // flip one byte of one question's ciphertext → its leaf no longer matches the
  // proof → openQuestion must throw QuestionIntegrityError, never render.
  const victim = { ...bundle.items[2]! };
  const ctBytes = Buffer.from(victim.ct, "hex");
  ctBytes[0] = ctBytes[0]! ^ 0xff;
  victim.ct = ctBytes.toString("hex");

  await assert.rejects(
    () => openQuestion(asTItem(victim), tMaster, EXAM, bundle.questionsRoot),
    QuestionIntegrityError,
  );
  // and the whole-bundle check also fails
  const tampered = { ...bundle, items: bundle.items.map((i, idx) => (idx === 2 ? victim : i)) };
  assert.equal(await verifyBundleAgainstRoot(asTBundle(tampered), bundle.questionsRoot), false);
});
