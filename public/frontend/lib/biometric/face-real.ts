/**
 * CryptoExam Core — REAL face recognition (client-side).
 *
 * Uses @vladmandic/face-api (a maintained face-api.js fork) loaded from CDN.
 * Produces a genuine 128-dimensional face descriptor (FaceNet/ResNet-34 trained
 * on LFW) and matches by Euclidean distance — the same method used in production
 * face-recognition systems.
 *
 * DPDP note: only the 128-float descriptor is ever stored, never the photo.
 * All processing happens in the browser; no image leaves the device.
 */

'use client';

// face-api is injected as a UMD global (window.faceapi). We type it loosely.
type FaceApi = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

/** Distance below which two descriptors are considered the same person.
 *  face-api's LFW model: 0.6 is the canonical "same person" boundary; we use a
 *  slightly stricter 0.5 for an exam-grade gate. */
export const FACE_MATCH_THRESHOLD = 0.5;

let _loadPromise: Promise<FaceApi> | null = null;

function injectScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('not in browser'));
    if ((window as any).faceapi) return resolve();
    const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('face-api script failed to load')));
      if ((window as any).faceapi) resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('face-api script failed to load (check network)'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('face-api script load timed out')), 20000);
  });
}

/** Load the library + the 3 model nets exactly once. Returns the faceapi global. */
export function loadFaceApi(): Promise<FaceApi> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    await injectScript();
    const faceapi: FaceApi = (window as any).faceapi;
    if (!faceapi) throw new Error('face-api did not initialise');
    if (!faceapi.nets.tinyFaceDetector.isLoaded) await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    if (!faceapi.nets.faceLandmark68Net.isLoaded) await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    if (!faceapi.nets.faceRecognitionNet.isLoaded) await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    return faceapi;
  })().catch((e) => {
    _loadPromise = null; // allow retry on failure
    throw e;
  });
  return _loadPromise;
}

export function isFaceApiReady(): boolean {
  const f = (typeof window !== 'undefined') ? (window as any).faceapi : null;
  return !!(f && f.nets.faceRecognitionNet.isLoaded);
}

export interface FaceDetectResult {
  descriptor: number[];      // 128 floats
  detectionScore: number;    // detector confidence 0..1
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Detect a single face in a <video> or <img> element and return its descriptor.
 * Returns null if no face is found.
 */
export async function detectFace(el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<FaceDetectResult | null> {
  const faceapi = await loadFaceApi();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
  const result = await faceapi
    .detectSingleFace(el, options)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  const { x, y, width, height } = result.detection.box;
  return {
    descriptor: Array.from(result.descriptor as Float32Array),
    detectionScore: result.detection.score,
    box: { x, y, width, height },
  };
}

/** Euclidean distance between two 128-float descriptors. */
export function descriptorDistance(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export interface FaceMatchResult {
  matched: boolean;
  distance: number;
  confidence: number;   // 0..1, derived from distance for display
}

/** Compare a live descriptor against an enrolled one. */
export function matchDescriptors(live: number[], enrolled: number[], threshold = FACE_MATCH_THRESHOLD): FaceMatchResult {
  const distance = descriptorDistance(live, enrolled);
  // Map distance → a friendly confidence. 0 → 1.0, threshold → ~0.5, 1.0+ → ~0.
  const confidence = Math.max(0, Math.min(1, 1 - distance / 1.0));
  return { matched: distance <= threshold, distance, confidence };
}
