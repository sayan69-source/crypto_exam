"use client";
/**
 * Where (if anywhere) this terminal can independently check the chain.
 *
 * A sealed exam hall is air-gapped: the firewall drops everything that is not
 * the Edge tunnel, so during the exam there is no RPC to call and this returns
 * null. That is correct, not a bug — but it means the root a paper is verified
 * against arrives from the same Edge that served the paper, and the surface has
 * to say so rather than implying an on-chain guarantee it cannot make.
 *
 * A reader exists when the deployment provides one:
 *   • the pre-exam staging window, when the terminal is still on a network;
 *   • a demo or proving ground pointed at a testnet RPC;
 *   • an operator workstation auditing a centre after the fact.
 *
 * Both values are NEXT_PUBLIC_ because the check happens in the browser, and
 * both are public information — a read-only RPC endpoint and a published
 * contract address. No key is involved; this can only read.
 */
import { RpcChainReader, type ChainReader } from "@/lib/chain-bridge";

export const CHAIN_RPC_URL = process.env.NEXT_PUBLIC_CHAIN_RPC_URL ?? "";
export const CHAIN_CONTRACT = process.env.NEXT_PUBLIC_CHAIN_CONTRACT ?? "";

/** A block explorer link for a lockExam tx, when the network is a known one. */
export const CHAIN_EXPLORER = process.env.NEXT_PUBLIC_CHAIN_EXPLORER ?? "https://amoy.polygonscan.com/tx/";

export function chainReader(): ChainReader | null {
  if (!CHAIN_RPC_URL || !CHAIN_CONTRACT) return null;
  return new RpcChainReader(CHAIN_RPC_URL, CHAIN_CONTRACT);
}

/**
 * Roots baked into this terminal at provisioning, before exam day.
 *
 * This is the air-gapped answer to "where does an independent root come from":
 * it was written into the signed image while the terminal was still under the
 * provisioning authority's control, so a centre cannot alter it on exam day
 * without breaking the image signature. Empty until the provisioning pipeline
 * populates it — and empty is reported honestly rather than assumed safe.
 */
export function pinnedRoots(): Record<string, string> {
  const raw = process.env.NEXT_PUBLIC_PINNED_EXAM_ROOTS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}
