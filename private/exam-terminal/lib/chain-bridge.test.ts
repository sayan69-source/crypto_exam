/**
 * The public↔private bridge, against a REAL chain.
 *
 * This file exists because `chain-bridge.ts` was, until now, imported by
 * nothing: the module that carries the entire trust story between the public
 * platform and the air-gapped centre was dead code, and dead code is not a
 * guarantee. Two halves are covered here:
 *
 *   1. `RpcChainReader` — pointed at a live node, reading a really-locked exam.
 *      Skipped (loudly) when no node is running, so `node --test` stays useful
 *      offline, but it is a REAL eth_call when one is:
 *
 *        cd public/contracts
 *        npx hardhat node &
 *        npx hardhat run deploy/01_deploy.ts       --network localhost
 *        npx hardhat run deploy/02_lock_demo_exam.ts --network localhost
 *
 *   2. `verifyRootProvenance` — the check that gives a verified bundle its
 *      meaning. Verifying a paper against a root the same Edge supplied proves
 *      only that the Edge is self-consistent; these cases pin down what happens
 *      when the root is confirmed, contradicted, or simply unconfirmable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BridgeError,
  RpcChainReader,
  chainExamKey,
  verifyRootProvenance,
  type ChainReader,
  type ChainExamRecord,
} from "./chain-bridge.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAM_JSON = join(HERE, "..", "..", "..", "public", "contracts", "deployments", "localhost.exam.json");
const RPC = process.env.TEST_RPC_URL ?? "http://127.0.0.1:8545";

interface LockedExam {
  contract: string; examId: string; chainKey: string;
  questionsRoot: string; bundleCid: string; drandRound: number; lockTx: string;
}

const locked: LockedExam | null = existsSync(EXAM_JSON)
  ? (JSON.parse(readFileSync(EXAM_JSON, "utf8")) as LockedExam)
  : null;

async function nodeIsUp(): Promise<boolean> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

test("RpcChainReader decodes a really-locked exam off a live chain", async (t) => {
  if (!locked || !(await nodeIsUp())) {
    t.skip(`no chain at ${RPC} with a locked exam — see the header of this file`);
    return;
  }
  const reader = new RpcChainReader(RPC, locked.contract);
  const record = await reader.getExamRecord(locked.examId, locked.chainKey);

  // Every field the terminal relies on, decoded out of raw eth_call return data
  // by hand. The dynamic-string offset maths is the part that silently returns
  // garbage when it is wrong, so assert the CID exactly, not just its presence.
  assert.equal(record.questionsRoot, locked.questionsRoot);
  assert.equal(record.bundleCid, locked.bundleCid);
  assert.equal(record.drandRound, locked.drandRound);
});

test("an exam that was never locked is reported as absent, not as a zero root", async (t) => {
  if (!locked || !(await nodeIsUp())) {
    t.skip("no live chain");
    return;
  }
  // Solidity returns the zero value for an unwritten mapping slot rather than
  // reverting, so "never locked" and "locked to nothing" look identical on the
  // wire. Treating that as a valid root would let any unlocked exam through.
  const reader = new RpcChainReader(RPC, locked.contract);
  const neverLocked = "0x" + "ab".repeat(32);
  await assert.rejects(
    () => reader.getExamRecord("no-such-exam", neverLocked),
    (e: Error) => e instanceof BridgeError && /no on-chain seal commitment/i.test(e.message),
  );
});

test("the terminal refuses to derive a chain key it was not provisioned with", () => {
  assert.throws(
    () => chainExamKey("44444444-4444-4444-4444-444444444444"),
    (e: Error) => e instanceof BridgeError && /provisioned with the exam/.test(e.message),
  );
  const key = "0x" + "cd".repeat(32);
  assert.equal(chainExamKey("any-exam", key), key);
});

// ── provenance ────────────────────────────────────────────────────────────
const ROOT_A = "0x" + "11".repeat(32);
const ROOT_B = "0x" + "22".repeat(32);
const EXAM = "44444444-4444-4444-4444-444444444444";

function fakeChain(root: string): ChainReader {
  return {
    async getExamRecord(examId: string): Promise<ChainExamRecord> {
      return { examId, questionsRoot: root, bundleCid: "ipfs://x", drandRound: 1 };
    },
  };
}

test("a root the chain confirms is reported as CHAIN-backed", async () => {
  const p = await verifyRootProvenance(EXAM, ROOT_A, { chain: fakeChain(ROOT_A), chainTx: "0xdead" });
  assert.equal(p.kind, "CHAIN");
});

test("a root the chain contradicts refuses the paper outright", async () => {
  // The centre served one paper, the chain committed another. This is the
  // substituted-paper case the whole architecture exists to catch, so it must
  // throw — never downgrade to a softer claim.
  await assert.rejects(
    () => verifyRootProvenance(EXAM, ROOT_A, { chain: fakeChain(ROOT_B) }),
    (e: Error) => e instanceof BridgeError && /Refusing to render/.test(e.message),
  );
});

test("a root contradicting the provisioned one refuses, even with no chain", async () => {
  await assert.rejects(
    () => verifyRootProvenance(EXAM, ROOT_A, { pinnedRoots: { [EXAM]: ROOT_B } }),
    (e: Error) => e instanceof BridgeError && /provisioned root wins/.test(e.message),
  );
});

test("an unreachable chain falls back to the provisioned root, not to trust", async () => {
  const dead: ChainReader = { async getExamRecord() { throw new Error("ENETUNREACH"); } };
  const p = await verifyRootProvenance(EXAM, ROOT_A, { chain: dead, pinnedRoots: { [EXAM]: ROOT_A } });
  assert.equal(p.kind, "PINNED");
});

test("with neither source the claim is downgraded to EDGE_ONLY, never silently upgraded", async () => {
  // This is the honest state of an air-gapped terminal today. It must be
  // reported so the surface can say so, rather than implying an on-chain
  // guarantee the deployment cannot make.
  const p = await verifyRootProvenance(EXAM, ROOT_A, {});
  assert.equal(p.kind, "EDGE_ONLY");
  assert.match((p as { reason: string }).reason, /no chain reader/);
});
