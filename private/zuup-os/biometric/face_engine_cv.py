#!/usr/bin/env python3
"""
ZUUP-OS real face-verification engine (spec §8.1/§8.3) — OpenCV backend.

This is the production-capable face engine that runs on commodity laptop/desk
webcams WITHOUT any proprietary SDK, using two small, openly-licensed ONNX
models from the OpenCV Zoo:

  • YuNet  (face_detection_yunet_2023mar.onnx, ~230 KB) — detection + 5 landmarks
  • SFace  (face_recognition_sface_2021dec.onnx, ~37 MB) — 128-D identity embedding

It produces exactly what the §8.2 match-all rule on the Edge consumes: a face
match score in [0,1], an active-liveness score in [0,1], and a face count.
The Edge still owns the *decision* (τ_face); this only turns pixels into scores.

FAIL-CLOSED everywhere: missing model, missing camera, zero or >1 face, a
liveness floor miss → score 0.0. There is no "assume human" path.

Privacy (§8.4 / DPDP): frames live in RAM only and are dropped immediately;
only the embedding + scores leave a call. Nothing is written to disk.

CLI (for on-device provisioning + verification on a real laptop):
  python face_engine_cv.py --selftest            # no camera: models + math
  python face_engine_cv.py --enroll  > emb.hex   # capture, print embedding hex
  python face_engine_cv.py --verify  <emb.hex>   # live capture, print scores
"""
from __future__ import annotations

import math
import os
import sys
import time

MODEL_DIR = os.environ.get("ZUUP_MODEL_DIR", "/usr/share/zuup/models")
YUNET = os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")
SFACE = os.path.join(MODEL_DIR, "face_recognition_sface_2021dec.onnx")
CAMERA = os.environ.get("ZUUP_CAMERA", "0")  # index or /dev/videoN

# SFace's reference cosine threshold for "same identity" is ~0.363. We rescale
# cosine so that threshold maps to 0.5, giving the Edge a stable τ_face≈0.6.
SFACE_COS_THRESHOLD = 0.363
LIVENESS_FLOOR = 0.80          # §8.3 — must be cleared before any score is sent
BURST_FRAMES = 12             # active-liveness capture window (~0.8 s)
SHARPNESS_FLOOR = 60.0        # Laplacian variance: rejects flat printed photos


def _rescale_cosine(cos: float) -> float:
    """Map raw SFace cosine → [0,1] with the same-identity threshold at 0.5."""
    if cos <= 0:
        return 0.0
    if cos >= 1:
        return 1.0
    if cos <= SFACE_COS_THRESHOLD:
        return 0.5 * (cos / SFACE_COS_THRESHOLD)
    return 0.5 + 0.5 * ((cos - SFACE_COS_THRESHOLD) / (1.0 - SFACE_COS_THRESHOLD))


class FaceEngineCV:
    def __init__(self) -> None:
        self._cv2 = None
        self._np = None
        self.detector = None
        self.recognizer = None
        try:
            import cv2          # type: ignore
            import numpy as np  # type: ignore
            self._cv2, self._np = cv2, np
            if os.path.exists(YUNET) and os.path.exists(SFACE):
                # input size is reset per-frame; 320x320 is a placeholder
                self.detector = cv2.FaceDetectorYN_create(YUNET, "", (320, 320),
                                                          score_threshold=0.7,
                                                          nms_threshold=0.3, top_k=50)
                self.recognizer = cv2.FaceRecognizerSF_create(SFACE, "")
        except Exception:
            self.detector = self.recognizer = None

    @property
    def available(self) -> bool:
        return self.detector is not None and self.recognizer is not None

    # ── detection / embedding primitives ────────────────────────────────────
    def _detect(self, frame):
        """Return the Nx15 YuNet detection array (box + 5 landmarks + score)."""
        h, w = frame.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(frame)
        return faces if faces is not None else self._np.empty((0, 15), dtype="float32")

    def _embed(self, frame, face_row):
        aligned = self.recognizer.alignCrop(frame, face_row)
        feat = self.recognizer.feature(aligned)
        return self._np.asarray(feat, dtype="float32").reshape(-1)

    @staticmethod
    def _cosine(a, b) -> float:
        import numpy as np
        if a is None or b is None or a.size == 0 or a.size != b.size:
            return 0.0
        denom = float(np.linalg.norm(a) * np.linalg.norm(b))
        return float(np.dot(a, b) / denom) if denom else 0.0

    def _sharpness(self, frame, box) -> float:
        cv2, np = self._cv2, self._np
        x, y, bw, bh = (max(0, int(v)) for v in box[:4])
        roi = frame[y:y + bh, x:x + bw]
        if roi.size == 0:
            return 0.0
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    # ── active liveness: a short burst, look for natural human micro-motion ──
    def _liveness_from_burst(self, frames) -> tuple[float, int]:
        """Heuristic active-liveness baseline (§8.3). Returns (score, faces).

        Real passive PAD (anti-spoof CNN) is the production upgrade; this
        baseline rejects the common low-effort attacks: it requires exactly one
        sharp face present across the burst, plus non-zero-but-bounded landmark
        motion (a held still photo → ~0 motion → reject; a waved photo → rigid,
        out-of-range motion → reject). It is intentionally conservative.
        """
        np = self._np
        centres, sharp_ok, single = [], 0, 0
        for f in frames:
            dets = self._detect(f)
            if dets.shape[0] == 1:
                single += 1
                box = dets[0]
                if self._sharpness(f, box) >= SHARPNESS_FLOOR:
                    sharp_ok += 1
                # eye landmarks (cols 4..7): right eye (4,5), left eye (6,7)
                centres.append(box[4:8].astype("float32"))
        n = len(frames)
        if single < max(2, int(0.7 * n)) or sharp_ok < max(2, int(0.5 * n)):
            return 0.0, (1 if single else 0)
        if len(centres) < 3:
            return 0.0, 1
        arr = np.vstack(centres)
        # inter-frame eye-landmark motion, normalised by inter-ocular distance
        iod = float(np.linalg.norm(arr[:, 0:2] - arr[:, 2:4], axis=1).mean()) or 1.0
        motion = float(np.linalg.norm(np.diff(arr, axis=0), axis=1).mean()) / iod
        # human micro-motion sits in a band; ~0 = static spoof, large = waved card
        if motion < 0.012:
            return 0.0, 1
        score = max(0.0, min(1.0, 1.0 - abs(motion - 0.05) / 0.12))
        return score, 1

    # ── the call the daemon makes ───────────────────────────────────────────
    def verify(self, enrolled_embedding: bytes, frames=None) -> dict:
        deny = {"score": 0.0, "liveness": 0.0, "faces": 0}
        if not self.available:
            return deny
        np = self._np
        if frames is None:
            frames = self._capture_burst()
        if not frames:
            return deny
        liveness, faces = self._liveness_from_burst(frames)
        if faces != 1 or liveness < LIVENESS_FLOOR:
            return {"score": 0.0, "liveness": liveness, "faces": faces}
        # embed the sharpest frame's single face
        best = max(frames, key=lambda f: self._sharpest_face(f))
        dets = self._detect(best)
        if dets.shape[0] != 1:
            return {"score": 0.0, "liveness": liveness, "faces": int(dets.shape[0])}
        live_emb = self._embed(best, dets[0])
        enrolled = np.frombuffer(enrolled_embedding, dtype="float32")
        score = _rescale_cosine(self._cosine(live_emb, enrolled))
        return {"score": score, "liveness": liveness, "faces": 1}

    def _sharpest_face(self, frame) -> float:
        dets = self._detect(frame)
        return self._sharpness(frame, dets[0]) if dets.shape[0] == 1 else 0.0

    def enroll(self, frames=None):
        """Capture and return a single-face embedding (provisioning)."""
        if not self.available:
            return None
        if frames is None:
            frames = self._capture_burst()
        best, best_s = None, -1.0
        for f in frames:
            dets = self._detect(f)
            if dets.shape[0] == 1:
                s = self._sharpness(f, dets[0])
                if s > best_s:
                    best, best_s = (f, dets[0]), s
        if best is None:
            return None
        return self._embed(best[0], best[1])

    def _capture_burst(self):
        cv2 = self._cv2
        src = int(CAMERA) if str(CAMERA).isdigit() else CAMERA
        cap = cv2.VideoCapture(src)
        frames = []
        try:
            if not cap.isOpened():
                return frames
            for _ in range(BURST_FRAMES):
                ok, f = cap.read()
                if ok:
                    frames.append(f)
                time.sleep(0.06)
        finally:
            cap.release()
        return frames


# ── CLI ─────────────────────────────────────────────────────────────────────
def _selftest() -> int:
    eng = FaceEngineCV()
    print(f"opencv backend available: {eng.available}  (models in {MODEL_DIR})")
    # cosine + rescale math holds regardless of camera/models
    import numpy as np
    a = np.array([1, 0, 0, 0], dtype="float32")
    assert eng._cosine(a, a) == 1.0
    assert eng._cosine(a, np.array([0, 1, 0, 0], dtype="float32")) == 0.0
    assert _rescale_cosine(1.0) == 1.0 and _rescale_cosine(0.0) == 0.0
    assert abs(_rescale_cosine(SFACE_COS_THRESHOLD) - 0.5) < 1e-6
    assert _rescale_cosine(0.7) > 0.5 and _rescale_cosine(0.2) < 0.5
    print("cosine + threshold-rescale math: OK")
    if eng.available:
        # prove the ONNX graphs load + run on a blank frame (→ 0 faces, deny)
        blank = np.zeros((240, 320, 3), dtype="uint8")
        d = eng._detect(blank)
        print(f"YuNet ran on a blank frame -> {d.shape[0]} faces (expect 0, fail-closed)")
        out = eng.verify(b"\x00" * (128 * 4), frames=[blank] * BURST_FRAMES)
        assert out["score"] == 0.0, "blank frames must score 0 (fail-closed)"
        print(f"fail-closed on no-face burst: {out}")
    print("SELFTEST OK")
    return 0


def main() -> int:
    if "--selftest" in sys.argv:
        return _selftest()
    eng = FaceEngineCV()
    if not eng.available:
        print("face engine unavailable (need opencv + models)", file=sys.stderr)
        return 2
    if "--enroll" in sys.argv:
        emb = eng.enroll()
        if emb is None:
            print("no single clear face captured", file=sys.stderr)
            return 1
        sys.stdout.write(emb.astype("float32").tobytes().hex() + "\n")
        return 0
    if "--verify" in sys.argv:
        i = sys.argv.index("--verify")
        enrolled = bytes.fromhex(sys.argv[i + 1])
        print(eng.verify(enrolled))
        return 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
