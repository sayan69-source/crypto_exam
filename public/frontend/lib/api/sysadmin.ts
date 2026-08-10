/**
 * Tier-0 System Admin API — enrolment and fingerprint login.
 *
 * The WebAuthn ceremony happens here in the browser; the SERVER does the
 * verification (backend/app/services/webauthn.py). Nothing in this file is a
 * security boundary — it only marshals bytes between the authenticator and the
 * API in the base64url shapes the backend expects.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export interface SysAdminStatus {
  your_ip: string;
  enrolment_open: boolean;
  ip_allowed: boolean;
  allowlist_configured: boolean;
  already_enrolled: boolean;
  hint: string;
}

/** base64url ⇄ ArrayBuffer, the encoding WebAuthn uses on the wire. */
const b64uToBuf = (s: string): ArrayBuffer => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
};
const bufToB64u = (b: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/sysadmin${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = json.detail;
    throw new Error(typeof d === 'string' ? d : d?.message || d?.reason || `Request failed (${res.status})`);
  }
  return json as T;
}

export const sysadminApi = {
  status: () => call<SysAdminStatus>('/status'),

  /** True when this machine has a fingerprint sensor (or equivalent) available. */
  async platformAuthenticatorAvailable(): Promise<boolean> {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  /**
   * Enrol. Creates a credential in this machine's secure element and sends the
   * PUBLIC key to the server — the private key never leaves the device.
   */
  async register(input: {
    email: string;
    fullName: string;
    password: string;
    faceDescriptorHash?: string;
  }) {
    const opts = await call<any>('/register/challenge', { email: input.email });

    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: b64uToBuf(opts.challenge),
        rp: opts.rp,
        user: {
          id: b64uToBuf(opts.user.id),
          name: opts.user.name,
          displayName: opts.user.displayName,
        },
        pubKeyCredParams: opts.pubKeyCredParams,
        authenticatorSelection: opts.authenticatorSelection,
        timeout: opts.timeout,
        attestation: opts.attestation,
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new Error('Fingerprint enrolment was cancelled.');

    const response = cred.response as AuthenticatorAttestationResponse;
    // getPublicKey() hands us SPKI DER directly, which is why the server needs
    // no CBOR parser to read the key.
    const spki = response.getPublicKey?.();
    if (!spki) {
      throw new Error(
        'This browser did not return the credential public key. Use a current Chrome, Edge, Safari or Firefox.',
      );
    }

    return call<{ ok: boolean; user_id: string; message: string }>('/register', {
      email: input.email,
      full_name: input.fullName,
      password: input.password,
      challenge: opts.challenge,
      credential_id: bufToB64u(cred.rawId),
      public_key_spki: bufToB64u(spki),
      client_data_json: bufToB64u(response.clientDataJSON),
      face_descriptor_hash: input.faceDescriptorHash ?? null,
    });
  },

  /**
   * Log in. Password first, then a fingerprint assertion — the server refuses
   * to issue a token without the second step.
   */
  async login(email: string, password: string) {
    const opts = await call<any>('/login/challenge', { email, password });

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: b64uToBuf(opts.challenge),
        rpId: opts.rpId,
        allowCredentials: opts.allowCredentials.map((c: any) => ({
          type: 'public-key',
          id: b64uToBuf(c.id),
        })),
        userVerification: opts.userVerification,
        timeout: opts.timeout,
      },
    })) as PublicKeyCredential | null;
    if (!assertion) throw new Error('Fingerprint verification was cancelled.');

    const r = assertion.response as AuthenticatorAssertionResponse;
    return call<{ access_token: string; expires_at: string; user: { id: string; email: string; role: string; full_name: string } }>(
      '/login',
      {
        email,
        challenge: opts.challenge,
        credential_id: bufToB64u(assertion.rawId),
        client_data_json: bufToB64u(r.clientDataJSON),
        authenticator_data: bufToB64u(r.authenticatorData),
        signature: bufToB64u(r.signature),
      },
    );
  },
};
