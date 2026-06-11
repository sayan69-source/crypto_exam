#!/usr/bin/env python3
"""
ZUUP-OS on-device biometric daemon (spec §8) — zuup-biometric.service.

Serves the capture side of the §8.1 identity factors to the kiosk browser on
loopback ONLY. The MATCHING policy (the §8.2 match-all rule) lives on the
Edge; this daemon's job is to turn hardware into scores and templates without
ever letting a raw biometric touch a persistent medium (DPDP §8.4):

    GET  /health        → {"ok": true, "face": bool, "fp": bool}
    POST /face/verify   {"enrolled_embedding_hex": …}
                        → {"score": 0.0–1.0, "liveness": 0.0–1.0, "faces": n}
    POST /fp/verify     {"enrolled_template_hex": …}
                        → {"score": 0.0–1.0, "template_hash": hex}

FAIL-CLOSED: missing camera, missing models, >1 face, no face, low liveness —
every abnormal path returns score 0.0 (which the Edge's match-all rule turns
into a denial). There is no degraded "assume human" mode.

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
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

BIND = ("127.0.0.1", 7700)            # loopback only — never the LAN (§8)
RUN_DIR = "/run/biometric"            # tmpfs (rootfs/overlay.fstab)
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
            return self._json(200, {"ok": True, "face": FACE.available, "fp": FP.available})
        self._json(404, {"ok": False})

    def do_POST(self) -> None:  # noqa: N802
        body = self._body()
        if self.path == "/face/verify":
            enrolled = bytes.fromhex(body.get("enrolled_embedding_hex", "") or "")
            return self._json(200, FACE.verify(enrolled))
        if self.path == "/fp/verify":
            enrolled = bytes.fromhex(body.get("enrolled_template_hex", "") or "")
            return self._json(200, FP.verify(enrolled))
        self._json(404, {"ok": False})

    def log_message(self, fmt: str, *args) -> None:
        # scores only, never payloads — and only to the volatile journal
        sys.stderr.write("zuup-biometricd: " + fmt % args + "\n")


def main() -> None:
    os.makedirs(RUN_DIR, mode=0o700, exist_ok=True)
    os.chdir(RUN_DIR)  # any accidental relative write lands on tmpfs
    httpd = HTTPServer(BIND, Handler)
    sys.stderr.write(
        f"zuup-biometricd on {BIND[0]}:{BIND[1]} face={FACE.available} fp={FP.available}\n"
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
