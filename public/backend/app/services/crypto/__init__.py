"""
CryptoExam Core — §§ 49–62 (CC-SSS Module) cryptography primitives.

This package adds Shamir's Secret Sharing over GF(p) and a simulated Nitro
Enclave Exam Processor — both **additive** layers above the existing
AES-GCM + HKDF + drand flow. No existing primitive in
`app/services/question_modes/answer_key_crypto.py` or
`lib/exam/paper-delivery.ts` is replaced or removed.

Use:
  - `shamir_sss.split_aes_key` / `reconstruct_aes_key` — proper Shamir SSS
  - `enclave_proxy` — talk to the simulated Nitro Enclave processor

The simulated enclave preserves the exact spec interface (GET_ATTESTATION /
SUBMIT_SHARE / PROCESS_QUESTION) so the production AWS Nitro Enclave path is a
drop-in replacement.
"""

from app.services.crypto.shamir_sss import (
    PRIME, SharePoint, split_aes_key, reconstruct_aes_key,
    encode_share, decode_share, _share_checksum, _test_sss,
)
from app.services.crypto.nitro_enclave import (
    SimulatedNitroEnclave, EnclaveProxy, AttestationDocument,
    enclave_proxy, encrypt_share_for_enclave,
)

__all__ = [
    "PRIME", "SharePoint", "split_aes_key", "reconstruct_aes_key",
    "encode_share", "decode_share", "_share_checksum", "_test_sss",
    "SimulatedNitroEnclave", "EnclaveProxy", "AttestationDocument",
    "enclave_proxy", "encrypt_share_for_enclave",
]
