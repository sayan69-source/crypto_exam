/**
 * CryptoExam Core — REAL device / network identity.
 *
 * Captures the device's public IP from a public echo service (no backend
 * needed). In production the backend also records `request.client.host`; this
 * client-side capture is the demo-friendly equivalent.
 */

'use client';

export interface DeviceInfo {
  ip: string;
  source: string;          // which service answered
  userAgent: string;
  platform: string;
  capturedAt: string;
}

const IP_SERVICES: { url: string; pick: (j: any) => string; name: string }[] = [
  { url: 'https://api.ipify.org?format=json', pick: (j) => j.ip, name: 'ipify' },
  { url: 'https://ipapi.co/json/', pick: (j) => j.ip, name: 'ipapi' },
  { url: 'https://api.my-ip.io/v2/ip.json', pick: (j) => j.ip, name: 'my-ip.io' },
];

export async function getPublicIP(): Promise<{ ip: string; source: string }> {
  for (const svc of IP_SERVICES) {
    try {
      const r = await fetch(svc.url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = await r.json();
      const ip = svc.pick(j);
      if (ip) return { ip, source: svc.name };
    } catch {
      /* try next */
    }
  }
  return { ip: 'unavailable', source: 'none' };
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  const { ip, source } = await getPublicIP();
  return {
    ip,
    source,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    platform: typeof navigator !== 'undefined' ? (navigator.platform || 'unknown') : 'unknown',
    capturedAt: new Date().toISOString(),
  };
}
