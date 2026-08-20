#!/usr/bin/env python3
"""
ZUUP-OS on-device biometric daemon (spec §8) — zuup-biometric.service.

Serves the capture side of the §8.1 identity factors to the kiosk browser on
loopback ONLY. The MATCHING policy (the §8.2 match-all rule) lives on the
Edge; this daemon's job is to turn hardware into SIGNED scores and templates
without ever letting a raw biometric touch a persistent medium (DPDP §8.4):

    GET  /health         → {"ok": true, "face": bool, "fp": bool, "signing": bool}
    POST /attest/verify  {"nonce": hex, "subject": "LOGIN"|"checkin:<roll>",
                          "enrolled_embedding_hex": …, "enrolled_template_hex": …}
                         → {"envelope": {...}, "sig": hex}
    POST /attest/enrol   {"nonce": hex}
                         → {"envelope": {...}, "sig": hex}

WHY THE SIGNATURE (§8.4). The daemon used to answer with a bare number and the
browser forwarded it to the Edge, so the face and fingerprint clauses of the
match-all rule were, in the end, two integers in an HTTP body that anything on
the machine could have written. The Edge now accepts a score only inside an
envelope signed by this daemon's attestation key, whose public half is
registered against this terminal at commissioning. The envelope also carries the
Edge's nonce (so a capture cannot be replayed) and a SUBJECT (so a capture of one
candidate cannot be used to check in the next).

Scores travel as integer BASIS POINTS, never floats: the verifier is JavaScript,
`json.dumps(1.0)` is "1.0" and `JSON.stringify(1.0)` is "1", and a signature over
a float would have failed exactly when the match was perfect.

FAIL-CLOSED: missing camera, missing models, >1 face, no face, low liveness —
every abnormal path scores 0 (which the Edge's match-all rule turns into a
denial). A missing signing key means the daemon serves no scores at all rather
than unsigned ones. There is no degraded "assume human" mode.

Privacy invariants enforced here (§8.4):
  • capture buffers live in /run/biometric (tmpfs, RAM) and are zeroised
    immediately after the embedding is computed;
  • only embeddings/templates and scores leave this process — never pixels;
  • nothing is ever written outside /run/biometric.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

BIND = ("127.0.0.1", 7700)            # loopback only — never the LAN (§8)
RUN_DIR = "/run/biometric"            # tmpfs (rootfs/overlay.fstab)
# Commissioning material. Two locations, in this order:
#
#   /etc/zuup/…            baked into the signed image by an authority. The
#                          production case; read-only, survives reboots.
#   /run/zuup-identity/…   written at first boot by a machine that commissioned
#                          ITSELF (all-in-one only). RAM-only — /etc is on the
#                          read-only verity root, so there is nowhere else it
#                          could go, and the keys dying at power-off is the
#                          correct behaviour for an ephemeral centre (INV-2).
#
# The baked one wins wherever both exist: a real commissioning is never
# overridden by something the machine wrote about itself.
BIO_KEY_CANDIDATES = [
    os.environ.get("ZUUP_BIO_KEY"),
    "/etc/zuup/biometric-attest.key",
    "/run/zuup-identity/biometric-attest.key",
]
TERMINAL_ID_CANDIDATES = [
    os.environ.get("ZUUP_TERMINAL_ID_FILE"),
    "/etc/zuup/terminal-id",
    "/run/zuup-identity/terminal-id",
]
BP = 10_000                           # scores travel as integer basis points
MODEL_DIR = "/usr/share/zuup/models"  # baked into the signed image
FACE_MODEL = os.path.join(MODEL_DIR, "face_embed.tflite")
LIVE_MODEL = os.path.join(MODEL_DIR, "liveness.tflite")
CAMERA_DEV = os.environ.get("ZUUP_CAMERA", "/dev/video0")
FP_READER = os.environ.get("ZUUP_FP_READER", "/dev/ttyACM0")  # CDC-ACM reader

EMBED_DIM = 192
LIVENESS_FLOOR = 0.80  # §8.3 passive-liveness floor before a score is emitted


def _zeroise(buf: bytearray) -> None:
    """Overwrite a capture buffer in place before releasing it (§8.4)."""
    ctypes.memset((ctypes.c_char * len(buf)).from_buffer(buf), 0, len(buf))


# ════════════════════════ attestation signing (§8.4) ════════════════════════
def _canonical(obj: dict) -> bytes:
    """The exact bytes the Edge will verify.

    Must equal `canonicalJson()` in edge-server/src/lib/crypto.ts: sorted keys,
    no whitespace, UTF-8. This is a paired implementation across two languages,
    so `_selftest_canonical` below pins it and the daemon refuses to start if it
    ever drifts — a mismatch here would look like a forged signature at the Edge
    and be diagnosed as a broken fingerprint reader.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


# One fixed sample and its canonical form, shared verbatim with
# edge-server/src/test/bio-attest.test.ts.
_CANON_SAMPLE = {
    "capturedAt": 1800000000000,
    "faceScoreBp": 9400,
    "fpScoreBp": 8800,
    "nonce": "ab12",
    "subject": "checkin:R-1461",
    "terminalId": "11111111-2222-3333-4444-555555555555",
}
_CANON_EXPECTED = (
    b'{"capturedAt":1800000000000,"faceScoreBp":9400,"fpScoreBp":8800,'
    b'"nonce":"ab12","subject":"checkin:R-1461",'
    b'"terminalId":"11111111-2222-3333-4444-555555555555"}'
)


def _selftest_canonical() -> None:
    produced = _canonical(dict(reversed(list(_CANON_SAMPLE.items()))))
    if produced != _CANON_EXPECTED:
        raise SystemExit(
            "zuup-biometricd: canonical JSON does not match the pinned contract; "
            "every signature this daemon produced would be rejected by the Edge.\n"
            f"  produced: {produced!r}\n  expected: {_CANON_EXPECTED!r}"
        )


class Signer:
    """Ed25519 attestation key for this terminal.

    The private half never leaves the machine and is never served; the public
    half is registered as `terminals.bio_pubkey_pem` at commissioning. Absent or
    unreadable key → `available` is False and every capture route answers 503,
    because serving an unsigned score would silently restore the hole this
    exists to close.
    """

    # A commissioned identity is a UUID. The image ships a placeholder until a
    # machine is commissioned, and signing envelopes as "REPLACE-AT-PROVISIONING"
    # would produce captures the Edge can only reject — with a failure that
    # points at the signature rather than at the real problem.
    _UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

    def __init__(self) -> None:
        self.key = None
        self.terminal_id = ""

        for path in (p for p in TERMINAL_ID_CANDIDATES if p):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    value = fh.read().strip()
            except OSError:
                continue
            if self._UUID.match(value):
                self.terminal_id = value.lower()
                break
        if not self.terminal_id:
            sys.stderr.write(
                "zuup-biometricd: no commissioned terminal identity; scores will not be served\n"
            )
            return

        for path in (p for p in BIO_KEY_CANDIDATES if p):
            if not os.path.exists(path):
                continue
            try:
                from cryptography.hazmat.primitives import serialization

                with open(path, "rb") as fh:
                    self.key = serialization.load_pem_private_key(fh.read(), password=None)
                break
            except Exception as exc:  # noqa: BLE001 — any failure is a hard denial
                sys.stderr.write(f"zuup-biometricd: cannot load {path} ({exc})\n")
                self.key = None
        if self.key is None:
            sys.stderr.write("zuup-biometricd: no attestation key; scores will not be served\n")

    @property
    def available(self) -> bool:
        return self.key is not None and bool(self.terminal_id)

    def envelope(self, fields: dict) -> dict:
        """Wrap measured fields into a signed envelope.

        `terminalId` comes from the machine's own identity file, never from the
        request: a daemon that signed whatever terminal id it was handed would
        let one compromised station mint envelopes for every other seat.
        """
        env = dict(fields)
        env["terminalId"] = self.terminal_id
        env["capturedAt"] = int(time.time() * 1000)
        return {"envelope": env, "sig": self.key.sign(_canonical(env)).hex()}


SIGNER = Signer()


class FaceEngine:
    """TF Lite face embedding + passive liveness over the UVC camera.

    All three dependencies (camera, embed model, liveness model) are probed at
    start; if ANY is missing the engine reports unavailable and every verify
    returns 0.0 — fail-closed, never fail-open.
    """

    def __init__(self) -> None:
        self.interpreter = None
        self.liveness = None
        try:
            from tflite_runtime.interpreter import Interpreter  # type: ignore
            if os.path.exists(FACE_MODEL) and os.path.exists(LIVE_MODEL):
                self.interpreter = Interpreter(model_path=FACE_MODEL)
                self.interpreter.allocate_tensors()
                self.liveness = Interpreter(model_path=LIVE_MODEL)
                self.liveness.allocate_tensors()
        except ImportError:
            pass

    @property
    def available(self) -> bool:
        return self.interpreter is not None and os.path.exists(CAMERA_DEV)

    def capture_frame(self) -> bytearray | None:
        """One V4L2 frame into a RAM buffer (no OpenCV — a raw read keeps the
        userland small). Returns None if the camera cannot deliver."""
        try:
            import v4l2capture  # type: ignore

            video = v4l2capture.Video_device(CAMERA_DEV)
            video.set_format(640, 480, fourcc="MJPG")
            video.create_buffers(1)
            video.queue_all_buffers()
            video.start()
            select_ok = video.fileno() >= 0
            frame = bytearray(video.read_and_queue()) if select_ok else None
            video.stop()
            video.close()
            return frame
        except Exception:
            return None

    def verify(self, enrolled_embedding: bytes) -> dict:
        deny = {"score": 0.0, "liveness": 0.0, "faces": 0}
        if not self.available:
            return deny
        frame = self.capture_frame()
        if frame is None:
            return deny
        try:
            faces, embedding, liveness = self._infer(frame)
        finally:
            _zeroise(frame)  # pixels die here, every path (§8.4)
        if faces != 1 or liveness < LIVENESS_FLOOR:
            return {"score": 0.0, "liveness": liveness, "faces": faces}
        return {"score": self._cosine(embedding, enrolled_embedding), "liveness": liveness, "faces": faces}

    def enrol(self) -> str:
        """One live capture, as the EMBEDDING itself (§9.2 step 3).

        Same liveness and single-face gates as verification: an enrolment taken
        from a photograph is a credential for whoever holds the photograph.
        Returns "" on any abnormal path, which the caller turns into a refusal
        rather than an identity with an empty biometric.
        """
        if not self.available:
            return ""
        frame = self.capture_frame()
        if frame is None:
            return ""
        try:
            faces, embedding, liveness = self._infer(frame)
        finally:
            _zeroise(frame)
        if faces != 1 or liveness < LIVENESS_FLOOR or not embedding:
            return ""
        # The embedding, NOT sha256 of it. `verify()` above compares with
        # `_cosine`, which does `np.frombuffer(..., dtype="float32")` on both
        # sides and returns 0.0 the moment the sizes differ — so a 32-byte
        # digest enrolled here scored 0.0 against every live capture forever,
        # including the genuine candidate's. The fingerprint engine below already
        # documents exactly this trap; the face path had fallen into it.
        return embedding.hex()

    # ── internals ───────────────────────────────────────────────────────────
    def _infer(self, frame: bytearray) -> tuple[int, bytes, float]:
        import numpy as np  # ships in the image with tflite_runtime

        rgb = self._decode(frame)
        if rgb is None:
            return 0, b"", 0.0
        # liveness first — a spoof never reaches the embedding model (§8.3)
        live_in = self.liveness.get_input_details()[0]
        self.liveness.set_tensor(live_in["index"], self._fit(rgb, live_in["shape"]))
        self.liveness.invoke()
        liveness = float(self.liveness.get_tensor(self.liveness.get_output_details()[0]["index"]).reshape(-1)[0])

        face_in = self.interpreter.get_input_details()[0]
        self.interpreter.set_tensor(face_in["index"], self._fit(rgb, face_in["shape"]))
        self.interpreter.invoke()
        out = self.interpreter.get_output_details()
        # model heads: [0] face count, [1] embedding
        faces = int(self.interpreter.get_tensor(out[0]["index"]).reshape(-1)[0])
        embedding = self.interpreter.get_tensor(out[1]["index"]).reshape(-1)[:EMBED_DIM]
        return faces, embedding.astype("float32").tobytes(), liveness

    @staticmethod
    def _decode(frame: bytearray):
        import numpy as np
        from PIL import Image
        import io

        try:
            img = Image.open(io.BytesIO(bytes(frame))).convert("RGB")
            return np.asarray(img, dtype="float32") / 255.0
        except Exception:
            return None

    @staticmethod
    def _fit(rgb, shape):
        import numpy as np
        from PIL import Image

        h, w = int(shape[1]), int(shape[2])
        img = Image.fromarray((rgb * 255).astype("uint8")).resize((w, h))
        return (np.asarray(img, dtype="float32") / 255.0)[None, ...]

    @staticmethod
    def _cosine(a_bytes: bytes, b_bytes: bytes) -> float:
        import numpy as np

        a = np.frombuffer(a_bytes, dtype="float32")
        b = np.frombuffer(b_bytes, dtype="float32")
        if a.size == 0 or a.size != b.size:
            return 0.0
        denom = float(np.linalg.norm(a) * np.linalg.norm(b))
        return max(0.0, float(a @ b) / denom) if denom else 0.0


class FingerprintEngine:
    """Vendor SDK shim (Mantra/SecuGen over CDC-ACM). The vendor library is
    dlopen'd if present in the image; raw images stay inside the SDK/driver —
    we receive a minutiae template + a match score only (§8.1)."""

    SDK = "/usr/lib/zuup/libzuup_fp_vendor.so"

    def __init__(self) -> None:
        self.lib = None
        if os.path.exists(self.SDK) and os.path.exists(FP_READER):
            try:
                self.lib = ctypes.CDLL(self.SDK)
                self.lib.zfp_capture_template.restype = ctypes.c_int
                self.lib.zfp_match.restype = ctypes.c_double
            except OSError:
                self.lib = None

    @property
    def available(self) -> bool:
        return self.lib is not None

    def verify(self, enrolled_template: bytes) -> dict:
        if not self.available:
            return {"score": 0.0, "template_hash": ""}
        buf = bytearray(4096)
        n = self.lib.zfp_capture_template(
            (ctypes.c_char * len(buf)).from_buffer(buf), len(buf)
        )
        if n <= 0:
            _zeroise(buf)
            return {"score": 0.0, "template_hash": ""}
        try:
            captured = bytes(buf[:n])
            score = float(
                self.lib.zfp_match(captured, n, enrolled_template, len(enrolled_template))
            )
            return {"score": max(0.0, min(1.0, score)), "template_hash": hashlib.sha256(captured).hexdigest()}
        finally:
            _zeroise(buf)

    def enrol(self) -> str:
        """Capture a minutiae template for first-time enrolment (§9.2 step 3).

        The TEMPLATE travels, not a hash of it: the vendor SDK matches template
        against template, so a digest here would enrol something that can never
        be matched. It is still not an image — the raw print never leaves the
        reader/driver.
        """
        if not self.available:
            return ""
        buf = bytearray(4096)
        n = self.lib.zfp_capture_template(
            (ctypes.c_char * len(buf)).from_buffer(buf), len(buf)
        )
        try:
            return bytes(buf[:n]).hex() if n > 0 else ""
        finally:
            _zeroise(buf)


def _select_face_engine():
    """Prefer the real OpenCV (YuNet+SFace) engine when its models are present;
    fall back to the TF Lite engine; if neither is available, the TF Lite
    engine's .available stays False and every verify fail-closes to 0.0.

    Both engines expose the same surface: .available (bool) and
    .verify(enrolled_embedding: bytes) -> {"score","liveness","faces"}.
    """
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from face_engine_cv import FaceEngineCV  # type: ignore

        cv = FaceEngineCV()
        if cv.available:
            sys.stderr.write("zuup-biometricd: face engine = opencv (YuNet+SFace)\n")
            return cv
    except Exception as exc:  # noqa: BLE001 — any import/model error → fall back
        sys.stderr.write(f"zuup-biometricd: opencv engine unavailable ({exc}); trying tflite\n")
    return FaceEngine()


FACE = _select_face_engine()
FP = FingerprintEngine()


def _hex(value) -> bytes:
    """Decode an enrolled template; anything malformed enrols nothing (score 0)."""
    if not isinstance(value, str):
        return b""
    try:
        return bytes.fromhex(value)
    except ValueError:
        return b""


def _bp(score) -> int:
    """A 0..1 engine score as whole basis points, clamped. Never a float."""
    try:
        s = float(score)
    except (TypeError, ValueError):
        return 0
    if s != s:  # NaN — an engine that could not decide does not get a pass
        return 0
    return max(0, min(BP, int(round(s * BP))))


class Handler(BaseHTTPRequestHandler):
    server_version = "zuup-biometricd"

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        try:
            n = int(self.headers.get("content-length", "0"))
            return json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return {}

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            return self._json(200, {
                "ok": True, "face": FACE.available, "fp": FP.available,
                "signing": SIGNER.available,
            })
        self._json(404, {"ok": False})

    def do_POST(self) -> None:  # noqa: N802
        body = self._body()
        # There is deliberately no unsigned route. The old /face/verify and
        # /fp/verify returned bare numbers, and every caller of them was one
        # forwarding hop away from the Edge treating those numbers as a
        # biometric. Removing them means no code path can produce a score the
        # Edge would accept without this daemon's signature.
        if not SIGNER.available:
            return self._json(503, {"ok": False, "reason": "NO_ATTESTATION_KEY"})

        nonce = body.get("nonce")
        if not isinstance(nonce, str) or not nonce:
            return self._json(400, {"ok": False, "reason": "MISSING_NONCE"})

        if self.path == "/attest/verify":
            subject = body.get("subject")
            if not isinstance(subject, str) or not subject:
                return self._json(400, {"ok": False, "reason": "MISSING_SUBJECT"})
            face = FACE.verify(_hex(body.get("enrolled_embedding_hex")))
            finger = FP.verify(_hex(body.get("enrolled_template_hex")))
            return self._json(200, SIGNER.envelope({
                "nonce": nonce,
                "subject": subject,
                "faceScoreBp": _bp(face.get("score")),
                "fpScoreBp": _bp(finger.get("score")),
            }))

        if self.path == "/attest/enrol":
            # The subject binds the capture to WHO it is of. It defaulted to the
            # bare constant "ENROL", which proves a finger was read and not whose
            # — so a signed capture could be replayed to enrol one person's
            # finger against another's roll. The caller passes
            # "enrol:candidate:<roll>" for a candidate; staff enrolment keeps the
            # constant and is unchanged.
            subject = body.get("subject") or "ENROL"
            if not isinstance(subject, str) or len(subject) > 128:
                return self._json(400, {"ok": False, "reason": "BAD_SUBJECT"})
            face_hash = FACE.enrol()
            template = FP.enrol()
            if not face_hash or not template:
                # A registration with nothing enrolled is worse than no
                # registration: it creates an identity that can never match.
                return self._json(503, {"ok": False, "reason": "CAPTURE_UNAVAILABLE"})
            return self._json(200, SIGNER.envelope({
                "nonce": nonce,
                "subject": subject,
                "faceEmbeddingHash": face_hash,
                "fingerprintTemplate": template,
            }))

        self._json(404, {"ok": False})

    def log_message(self, fmt: str, *args) -> None:
        # scores only, never payloads — and only to the volatile journal
        sys.stderr.write("zuup-biometricd: " + fmt % args + "\n")


def main() -> None:
    # Before anything is served: prove this process serialises exactly what the
    # Edge will verify. A drift here produces signatures that look forged.
    _selftest_canonical()
    os.makedirs(RUN_DIR, mode=0o700, exist_ok=True)
    os.chdir(RUN_DIR)  # any accidental relative write lands on tmpfs
    httpd = HTTPServer(BIND, Handler)
    sys.stderr.write(
        f"zuup-biometricd on {BIND[0]}:{BIND[1]} face={FACE.available} "
        f"fp={FP.available} signing={SIGNER.available}\n"
    )
    if not SIGNER.available:
        # Serving /health while refusing every capture is the honest state: the
        # station is up, it simply cannot make a claim anyone should believe.
        sys.stderr.write(
            "zuup-biometricd: NOT COMMISSIONED — every capture route will answer 503. "
            "Needs a terminal id and an attestation key in /etc/zuup (baked by an "
            "authority) or /run/zuup-identity (written at first boot).\n"
        )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
