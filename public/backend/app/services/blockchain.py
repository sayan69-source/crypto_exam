"""
CryptoExam Core — Blockchain Service
§ 12 — Web3 interface for Polygon PoS smart contract interactions.

This service bridges the FastAPI backend with the CryptoExamCore.sol
contract on Polygon Amoy. All on-chain transactions are signed server-side
using the deployer's private key.

Public verification functions require NO authentication — anyone
with a browser can call verifyExam() on Polygonscan.
"""

import hashlib
import json
import logging
from pathlib import Path
from typing import Optional

from web3 import AsyncWeb3, AsyncHTTPProvider
from web3.contract import AsyncContract
from eth_account import Account
from eth_account.signers.local import LocalAccount

from app.config import get_settings

logger = logging.getLogger(__name__)

# The Hardhat artifact, once `npx hardhat compile` has run. app/services →
# app → backend → public, then into contracts/ — the sibling package, not a
# directory under backend/ (which is where this used to look, so the full ABI
# was never found and the minimal fallback was always used).
ABI_PATH = (
    Path(__file__).resolve().parents[3]
    / "contracts" / "artifacts" / "src" / "CryptoExamCore.sol" / "CryptoExamCore.json"
)


class ChainUnavailable(Exception):
    """
    Something the chain layer needs is not configured or not reachable.

    Carries a machine-readable `reason` so the API can answer "nothing is
    deployed" differently from "the RPC timed out", instead of collapsing both
    into a 500. Mirrors CapabilityUnavailable in services/exam_lifecycle.py.
    """

    def __init__(self, reason: str, message: str, **context):
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.context = {k: v for k, v in context.items() if v is not None}


class ContractNotDeployed(ChainUnavailable):
    """No usable CryptoExamCore address is configured."""


def _as_bytes32(value: bytes | str) -> bytes:
    """
    Coerce a root/hash to the 32 bytes the contract expects.

    Callers reach these methods from three directions — the ORM (bytes), the
    sealing pipeline (`0x…` hex) and Celery payloads (JSON, so always a string).
    The old code assumed bytes and called `.hex()` on whatever it got, so a
    perfectly good hex root raised `'str' object has no attribute 'hex'` and the
    lock went un-anchored.
    """
    if isinstance(value, str):
        raw = bytes.fromhex(value[2:] if value.startswith(("0x", "0X")) else value)
    else:
        raw = bytes(value)
    if len(raw) != 32:
        raise ValueError(f"Expected a 32-byte hash, got {len(raw)} bytes")
    return raw


def _is_address(value: Optional[str]) -> bool:
    """True for a 20-byte hex address — not a placeholder like `<deployed_address>`."""
    if not value:
        return False
    v = value.strip()
    if v.startswith("0x") or v.startswith("0X"):
        v = v[2:]
    return len(v) == 40 and all(ch in "0123456789abcdefABCDEF" for ch in v)


class BlockchainService:
    """
    Web3 interface for CryptoExamCore.sol on Polygon PoS.

    All write operations use the deployer's private key.
    All read operations are publicly accessible.
    """

    def __init__(self):
        settings = get_settings()
        self.rpc_url = settings.POLYGON_RPC_URL
        self.w3 = AsyncWeb3(AsyncHTTPProvider(settings.POLYGON_RPC_URL))
        # Polygon is a POA chain — without this middleware get_block() raises on
        # the 97-byte extraData field ("should be 32 bytes") and status reports
        # connected=false even though the RPC is reachable.
        try:
            from web3.middleware import ExtraDataToPOAMiddleware
            self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        except Exception as exc:  # never block startup on middleware wiring
            logger.warning("Could not inject POA middleware: %s", exc)
        self.chain_id = settings.POLYGON_CHAIN_ID
        self.contract_address = settings.CRYPTOEXAM_CONTRACT_ADDRESS

        # Signer
        if settings.DEPLOYER_PRIVATE_KEY:
            self.account: Optional[LocalAccount] = Account.from_key(settings.DEPLOYER_PRIVATE_KEY)
        else:
            self.account = None
            logger.warning("No DEPLOYER_PRIVATE_KEY — blockchain write operations disabled")

        self._contract: Optional[AsyncContract] = None

    async def _get_contract(self) -> AsyncContract:
        """Lazy-load the contract ABI and return the contract instance."""
        if self._contract is not None:
            return self._contract

        # `.env` ships CRYPTOEXAM_CONTRACT_ADDRESS as a placeholder, and web3
        # then failed deep inside checksumming with "Unknown format ''" — an
        # HTTP 500 that reads like a bug rather than "nothing is deployed yet".
        # Say what is actually missing.
        if not _is_address(self.contract_address):
            raise ContractNotDeployed(
                "CONTRACT_NOT_DEPLOYED",
                (
                    "No CryptoExamCore address is configured, so there is nothing on "
                    "chain to read. Deploy it and set CRYPTOEXAM_CONTRACT_ADDRESS: "
                    "cd public/contracts && npx hardhat run deploy/01_deploy.ts --network amoy"
                ),
                configured=self.contract_address or None,
                rpc=self.rpc_url,
            )

        if ABI_PATH.exists():
            with open(ABI_PATH) as f:
                artifact = json.load(f)
                abi = artifact["abi"]
        else:
            # Fallback: minimal ABI for the functions we use
            abi = self._get_minimal_abi()
            logger.warning("Using minimal ABI — compile contracts for full ABI")

        self._contract = self.w3.eth.contract(
            address=self.w3.to_checksum_address(self.contract_address),
            abi=abi,
        )
        return self._contract

    async def _send_tx(self, fn, *args) -> str:
        """Build, sign, and send a transaction. Returns tx hash."""
        if not self.account:
            raise RuntimeError("No deployer key configured — cannot send transactions")

        contract = await self._get_contract()
        func = getattr(contract.functions, fn)(*args)

        nonce = await self.w3.eth.get_transaction_count(self.account.address)
        gas_price = await self.w3.eth.gas_price

        tx = await func.build_transaction({
            "chainId": self.chain_id,
            "from": self.account.address,
            "nonce": nonce,
            "gasPrice": gas_price,
        })

        # Estimate gas
        tx["gas"] = await self.w3.eth.estimate_gas(tx)

        signed = self.account.sign_transaction(tx)
        tx_hash = await self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = await self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        logger.info(
            f"TX confirmed: fn={fn}, hash={tx_hash.hex()}, "
            f"block={receipt['blockNumber']}, gas={receipt['gasUsed']}"
        )
        return tx_hash.hex()

    # ═══════════════════════════════════════════════════════
    # Write Functions (require deployer key)
    # ═══════════════════════════════════════════════════════

    async def lock_exam(
        self,
        exam_id: str,
        question_hash: bytes | str,
        drand_round: int,
        constraint_spec_ipfs: str = "",
    ) -> str:
        """
        Lock an exam on-chain — register question hash and drand round.

        Args:
            exam_id: UUID string of the exam.
            question_hash: SHA-256 hash of the encrypted paper.
            drand_round: drand beacon round for T₀ key derivation.
            constraint_spec_ipfs: IPFS CID for IRT constraint spec.

        Returns:
            Transaction hash (hex string).
        """
        exam_id_bytes = self.w3.keccak(text=exam_id)
        qhash = _as_bytes32(question_hash)

        tx_hash = await self._send_tx(
            "lockExam",
            exam_id_bytes,
            qhash,
            drand_round,
            constraint_spec_ipfs,
        )

        logger.info(f"Exam locked on-chain: exam={exam_id[:8]}..., tx={tx_hash[:16]}...")
        return tx_hash

    async def submit_zk_proof(
        self,
        exam_id: str,
        proof: dict,
        public_signals: list,
        proof_ipfs: str = "",
    ) -> str:
        """
        Submit the Groth16 proof itself; the chain runs the pairing check.

        The contract used to take a hash and record `zkVerified = true` on the
        submitter's word. It now takes the proof and calls the deployed
        Groth16Verifier, so this transaction REVERTS on a proof that does not
        verify — which is the only version of the guarantee worth claiming.

        Args:
            exam_id: UUID string.
            proof: snarkjs Groth16 proof dict (pi_a / pi_b / pi_c).
            public_signals: The five public inputs, as decimal strings.
            proof_ipfs: Content address of the full proof for independent checking.

        Returns:
            Transaction hash.
        """
        if len(public_signals) != 5:
            raise ValueError(
                f"The circuit declares 5 public signals, got {len(public_signals)} — "
                "the proving key and the contract are out of step."
            )

        exam_id_bytes = self.w3.keccak(text=exam_id)
        a, b, c = self.format_for_contract(proof)

        return await self._send_tx(
            "submitZKProof",
            exam_id_bytes,
            a,
            b,
            c,
            [int(s) for s in public_signals],
            proof_ipfs,
        )

    @staticmethod
    def format_for_contract(proof: dict) -> tuple[list, list, list]:
        """
        snarkjs proof → Solidity calldata.

        π_b's G2 coordinates come out of snarkjs in the opposite order to the
        one the generated verifier reads, so each pair is swapped here. Getting
        this wrong produces a well-formed proof that simply never verifies.
        """
        a = [int(proof["pi_a"][0]), int(proof["pi_a"][1])]
        b = [
            [int(proof["pi_b"][0][1]), int(proof["pi_b"][0][0])],
            [int(proof["pi_b"][1][1]), int(proof["pi_b"][1][0])],
        ]
        c = [int(proof["pi_c"][0]), int(proof["pi_c"][1])]
        return a, b, c

    async def commit_merkle_root(
        self,
        exam_id: str,
        merkle_root: bytes | str,
        candidate_count: int,
    ) -> str:
        """
        Commit the answer Merkle root on-chain.

        This is IMMUTABLE once committed. Any subsequent modification
        to any candidate's answers produces a different root.

        Args:
            exam_id: UUID string.
            merkle_root: 32-byte Merkle root hash.
            candidate_count: Number of candidates in the tree.

        Returns:
            Transaction hash.
        """
        exam_id_bytes = self.w3.keccak(text=exam_id)
        root = _as_bytes32(merkle_root)

        tx_hash = await self._send_tx(
            "commitAnswerMerkleRoot",
            exam_id_bytes,
            root,
            candidate_count,
        )

        logger.info(
            f"Merkle root committed: exam={exam_id[:8]}..., "
            f"root={root.hex()[:16]}..., "
            f"candidates={candidate_count}, tx={tx_hash[:16]}..."
        )
        return tx_hash

    async def anchor_centre_answer_root(
        self,
        exam_id: str,
        centre_id_hash: str,
        answer_root: str,
        count: int,
        node_pubkey: str,
    ) -> str:
        """
        Anchor ONE centre's answer-root for an exam (ZUUP-OS §11.5).

        Called by the System Admin AFTER HSM-decrypting that centre's sync
        bundle and re-verifying its hash-chain off-chain. NO PII goes on chain —
        only the SHA-256 of the centre id, the chain root, a count, and the
        centre node signing pubkey (§11.6 / DPDP). One anchor per (exam, centre):
        the contract reverts a second attempt, so a root can never be back-dated.

        Args:
            exam_id: UUID string (hashed to bytes32 with keccak on chain).
            centre_id_hash: SHA-256(centreId) hex — NEVER the raw centre id.
            answer_root: final centre Merkle hash-chain root, hex.
            count: number of sealed submissions in the chain.
            node_pubkey: centre node signing pubkey (raw 32 bytes), hex.

        Returns:
            Transaction hash.
        """
        exam_id_bytes = self.w3.keccak(text=exam_id)

        tx_hash = await self._send_tx(
            "anchorCentreAnswerRoot",
            exam_id_bytes,
            bytes.fromhex(centre_id_hash),
            bytes.fromhex(answer_root),
            count,
            bytes.fromhex(node_pubkey).ljust(32, b"\x00")[:32],
        )

        logger.info(
            f"Centre answer-root anchored: exam={exam_id[:8]}..., "
            f"centre={centre_id_hash[:12]}..., count={count}, tx={tx_hash[:16]}..."
        )
        return tx_hash

    async def submit_delivery_proof(
        self,
        exam_id: str,
        node_serial: str,
        tpm_signature: bytes,
        gps_timestamp: int,
        latitude: int,
        longitude: int,
    ) -> str:
        """
        Submit a hardware node delivery proof.

        Args:
            exam_id: UUID string.
            node_serial: Hardware node serial number.
            tpm_signature: TPM 2.0 signed attestation.
            gps_timestamp: GPS UTC timestamp.
            latitude: Latitude × 1e6.
            longitude: Longitude × 1e6.

        Returns:
            Transaction hash.
        """
        exam_id_bytes = self.w3.keccak(text=exam_id)
        node_id_bytes = self.w3.keccak(text=node_serial)

        return await self._send_tx(
            "submitDeliveryProof",
            exam_id_bytes,
            node_id_bytes,
            tpm_signature,
            gps_timestamp,
            latitude,
            longitude,
        )

    # ═══════════════════════════════════════════════════════
    # Read Functions (no auth required — publicly verifiable)
    # ═══════════════════════════════════════════════════════

    async def verify_exam(self, exam_id: str) -> dict:
        """
        Fetch on-chain exam record. Callable by ANYONE.

        Returns:
            Dict with questionHash, zkProofHash, answerMerkleRoot,
            lockTimestamp, drandRound, candidateCount, zkVerified, etc.
        """
        contract = await self._get_contract()
        exam_id_bytes = self.w3.keccak(text=exam_id)

        result = await contract.functions.verifyExam(exam_id_bytes).call()

        return {
            "questionHash": result[0].hex(),
            "zkProofHash": result[1].hex(),
            "answerMerkleRoot": result[2].hex(),
            "zkProofIPFS": result[3],
            "lockTimestamp": result[4],
            "drandRound": result[5],
            "candidateCount": result[6],
            "zkVerified": result[7],
            "answerCommitted": result[8],
        }

    async def get_exam_count(self) -> int:
        """Get total number of exams registered on-chain."""
        contract = await self._get_contract()
        return await contract.functions.getExamCount().call()

    async def verify_delivery(self, exam_id: str, node_serial: str) -> dict:
        """Verify a delivery proof on-chain."""
        contract = await self._get_contract()
        exam_id_bytes = self.w3.keccak(text=exam_id)
        node_id_bytes = self.w3.keccak(text=node_serial)

        result = await contract.functions.verifyDelivery(exam_id_bytes, node_id_bytes).call()

        return {
            "gpsTimestamp": result[0],
            "latitude": result[1],
            "longitude": result[2],
            "verified": result[3],
        }

    async def get_chain_info(self) -> dict:
        """Get current blockchain status."""
        block = await self.w3.eth.get_block("latest")
        balance = 0
        if self.account:
            balance = await self.w3.eth.get_balance(self.account.address)

        return {
            "chainId": self.chain_id,
            "latestBlock": block["number"],
            "contractAddress": self.contract_address,
            "deployerAddress": self.account.address if self.account else None,
            "deployerBalance": str(self.w3.from_wei(balance, "ether")) + " MATIC",
            "connected": await self.w3.is_connected(),
        }

    # ═══════════════════════════════════════════════════════
    # Utility
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def exam_id_to_bytes32(exam_id: str) -> bytes:
        """Convert exam UUID to bytes32 for contract calls."""
        from web3 import Web3
        return Web3.keccak(text=exam_id)

    @staticmethod
    def polygonscan_url(tx_hash: str, testnet: bool = True) -> str:
        """Generate Polygonscan link for a transaction."""
        base = "https://amoy.polygonscan.com" if testnet else "https://polygonscan.com"
        return f"{base}/tx/{tx_hash}"

    def _get_minimal_abi(self) -> list:
        """Minimal ABI for core contract functions (fallback when artifacts not compiled)."""
        return [
            {
                "inputs": [{"name": "examId", "type": "bytes32"}, {"name": "questionHash", "type": "bytes32"}, {"name": "drandRound", "type": "uint256"}, {"name": "constraintSpecIPFS", "type": "string"}],
                "name": "lockExam",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [{"name": "examId", "type": "bytes32"}, {"name": "a", "type": "uint256[2]"}, {"name": "b", "type": "uint256[2][2]"}, {"name": "c", "type": "uint256[2]"}, {"name": "publicSignals", "type": "uint256[5]"}, {"name": "zkProofIPFS", "type": "string"}],
                "name": "submitZKProof",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [{"name": "examId", "type": "bytes32"}, {"name": "merkleRoot", "type": "bytes32"}, {"name": "candidateCount", "type": "uint64"}],
                "name": "commitAnswerMerkleRoot",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [{"name": "examId", "type": "bytes32"}, {"name": "nodeId", "type": "bytes32"}, {"name": "tpmSignature", "type": "bytes"}, {"name": "gpsTimestamp", "type": "uint256"}, {"name": "latitude", "type": "int64"}, {"name": "longitude", "type": "int64"}],
                "name": "submitDeliveryProof",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [{"name": "examId", "type": "bytes32"}],
                "name": "verifyExam",
                "outputs": [{"name": "questionHash", "type": "bytes32"}, {"name": "zkProofHash", "type": "bytes32"}, {"name": "answerMerkleRoot", "type": "bytes32"}, {"name": "zkProofIPFS", "type": "string"}, {"name": "lockTimestamp", "type": "uint256"}, {"name": "drandRound", "type": "uint256"}, {"name": "candidateCount", "type": "uint64"}, {"name": "zkVerified", "type": "bool"}, {"name": "answerCommitted", "type": "bool"}],
                "name": "verifyExam",
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "getExamCount",
                "outputs": [{"name": "", "type": "uint256"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [{"name": "examId", "type": "bytes32"}, {"name": "nodeId", "type": "bytes32"}],
                "name": "verifyDelivery",
                "outputs": [{"name": "gpsTimestamp", "type": "uint256"}, {"name": "latitude", "type": "int64"}, {"name": "longitude", "type": "int64"}, {"name": "verified", "type": "bool"}],
                "stateMutability": "view",
                "type": "function"
            },
        ]
