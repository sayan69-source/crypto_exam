/**
 * Turn a FastAPI error body into something a human can act on.
 *
 * The backend returns `detail` in three different shapes and the clients only
 * understood two of them:
 *
 *   422  detail: [{ loc: ["body","email"], msg: "…should have a period." }]
 *   4xx  detail: { reason: "…", message: "…" }        (our own raised errors)
 *   4xx  detail: "plain string"                        (FastAPI shorthand)
 *
 * The array form is the one every validation failure uses, and because it is
 * an array `detail?.message` is undefined — so a precise, genuinely useful
 * message ("The part after the @-sign is not valid") was being replaced with
 * "Request failed (422)". The user is then told only that something went
 * wrong, on the one screen where they could have fixed it themselves.
 */

interface ValidationItem {
  loc?: (string | number)[];
  msg?: string;
}

/** Field name from a Pydantic `loc`, skipping the "body"/"query" prefix. */
function fieldName(loc: (string | number)[] | undefined): string | null {
  if (!loc?.length) return null;
  const parts = loc.filter((p) => !['body', 'query', 'path', 'header'].includes(String(p)));
  return parts.length ? String(parts[parts.length - 1]) : null;
}

/** Pydantic prefixes its messages; the prefix is noise once we name the field. */
function tidy(msg: string): string {
  return msg.replace(/^Value error,\s*/i, '').replace(/^value is not a valid /i, 'is not a valid ');
}

export function describeApiError(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;

  if (typeof detail === 'string' && detail.trim()) return detail;

  if (Array.isArray(detail)) {
    const parts = (detail as ValidationItem[])
      .map((d) => {
        const msg = tidy(String(d.msg ?? '').trim());
        if (!msg) return null;
        const field = fieldName(d.loc);
        // "email: is not a valid email address: …" reads badly; the tidied
        // message already starts with "is not a valid" in that case.
        return field ? `${field} ${msg.startsWith('is ') ? msg : `— ${msg}`}` : msg;
      })
      .filter(Boolean);
    if (parts.length) return parts.join('. ');
  }

  if (detail && typeof detail === 'object') {
    const d = detail as { message?: string; reason?: string };
    if (d.message) return d.message;
    if (d.reason) return d.reason;
  }

  const m = (body as { message?: string } | null)?.message;
  if (typeof m === 'string' && m.trim()) return m;

  // Last resort — at least say what kind of failure it was.
  if (status === 401) return 'Those credentials were not accepted.';
  if (status === 403) return 'You are not allowed to do that.';
  if (status === 404) return 'Not found.';
  if (status >= 500) return 'The server hit an error. Check its logs.';
  return `Request failed (${status}).`;
}
