/**
 * Tier-0 System Admin API — enrolment and fingerprint login.
 *
 * The WebAuthn ceremony happens here in the browser; the SERVER does the
 * verification (backend/app/services/webauthn.py). Nothing in this file is a
 * security boundary — it only marshals bytes between the authenticator and the
 * API in the base64url shapes the backend expects.
 */
import { describeApiError } from './errors';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export interface SysAdminStatus {
  your_ip: string;
  enrolment_open: boolean;
  ip_allowed: boolean;
  allowlist_configured: boolean;
  /** A bootstrap token is configured server-side — the route that works on a PaaS. */
  token_configured?: boolean;
  /** Which gate let this request through, when one did. */
  gate?: string | null;
  already_enrolled: boolean;
  hint: string;
}

/**
 * The tier-0 bootstrap token, held only for the duration of the enrolment.
 *
 * A hosted deployment cannot gate first enrolment on an IP allowlist: the
 * operator's egress address is unknown in advance and changes. The token is
 * typed in once, sent as a header, and never stored — it authorises creating
 * the account, not using it.
 */
let enrolmentToken: string | null = null;
export function setEnrolmentToken(t: string | null) { enrolmentToken = t?.trim() || null; }

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
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/sysadmin${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(enrolmentToken ? { 'x-enrolment-token': enrolmentToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    // A dead backend surfaces as the browser's bare "Failed to fetch", which
    // reads like a fingerprint problem on this page and sends people looking
    // at their sensor. Name the actual cause.
    throw new Error(
      `Cannot reach the API at ${API_BASE}. Start the backend (\`npm run backend\`) and try again — this is not a fingerprint problem.`,
    );
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(describeApiError(json, res.status));
  }
  return json as T;
}

/**
 * Turn a WebAuthn DOMException into something actionable.
 *
 * The browser's own messages are famously unhelpful ("The operation either
 * timed out or was not allowed"), and every distinct cause below arrives as
 * the same NotAllowedError.
 */
function describeWebAuthnError(e: unknown, action: 'enrol' | 'sign in'): Error {
  const name = (e as DOMException)?.name;

  // The commonest real misconfiguration: RP ID is "localhost" but the page was
  // opened on 127.0.0.1. Same machine, different host — WebAuthn refuses.
  if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
    return new Error(
      'Open the site at http://localhost:3000 instead of 127.0.0.1:3000. ' +
        'The security key is registered to the host name "localhost", and the browser treats 127.0.0.1 as a different site.',
    );
  }
  if (name === 'NotAllowedError') {
    return new Error(
      `The fingerprint prompt was dismissed or timed out. Try again and complete the Windows Hello / Touch ID prompt to ${action}.`,
    );
  }
  if (name === 'InvalidStateError') {
    return new Error('This device already has a credential registered for that account. Sign in instead.');
  }
  if (name === 'NotSupportedError') {
    return new Error('This device has no fingerprint sensor (platform authenticator) that the browser can use.');
  }
  if (name === 'SecurityError') {
    return new Error(
      `The page origin is not one the server accepts for security keys. Use http://localhost:3000. (${(e as Error).message})`,
    );
  }
  if (name === 'AbortError') return new Error('The fingerprint prompt was cancelled.');
  return new Error((e as Error)?.message || `Could not ${action} with a fingerprint.`);
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

    let cred: PublicKeyCredential | null;
    try {
      cred = (await navigator.credentials.create({
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
    } catch (e) {
      throw describeWebAuthnError(e, 'enrol');
    }
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

    let assertion: PublicKeyCredential | null;
    try {
      assertion = (await navigator.credentials.get({
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
    } catch (e) {
      throw describeWebAuthnError(e, 'sign in');
    }
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
