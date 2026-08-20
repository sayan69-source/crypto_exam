# CryptoExam Core — New Bug Fix & Hardening Plan

Repository:

`https://github.com/sayan69-source/crypto_exam`

Branch:

`main`

Stack:

- Next.js 16 + TypeScript frontend: `public/frontend`
- FastAPI backend: `public/backend`
- Separate private centre/admin portals
- Biometric/WebAuthn functionality
- Existing mock/dev mode controlled by `NEXT_PUBLIC_USE_MOCK`

## Objective

Fix the following currently observed problems without breaking the existing biometric, authentication, navigation, exam, or public-verification flows.

### Problems to fix

1. **Invigilator registration/login location is hard-coded to New Delhi**
   - Registration displays New Delhi regardless of where the registration is actually taking place.
   - Login silently falls back to New Delhi coordinates when browser geolocation fails.
   - This can cause incorrect geofence verification.
   - There must be no silent fallback to an invented/default geographic location.

2. **Public Exam Verification Exam ID field cannot reliably be typed into or pasted into**
   - The field shown in the supplied screenshot labelled `EXAM ID (UUID)` must accept normal keyboard input.
   - Ctrl+V / Cmd+V, right-click paste, browser autofill/input, and manually typing a UUID must all work.
   - Anti-cheat/clipboard restrictions from actual exam-session routes must not leak into this public verification page.

3. **FAQ button opens the home page instead of FAQ**
   - Locate every FAQ link/button in the current codebase.
   - Correct its destination.
   - Ensure an actual `/faq` route exists and is reachable directly.
   - Ensure no click handler, fallback redirect, form submission, or navigation middleware sends FAQ users to `/`.

4. **Fake/non-existent email addresses are being accepted**
   - The current email validation must not be treated as proof that an email address actually exists.
   - A syntactically valid but non-existent, disposable, temporary, or otherwise unverified mailbox must not be accepted as a verified invigilator identity.
   - Email ownership must be verified server-side before the account/enrollment is treated as legitimate.
   - Do not attempt to solve this only with a frontend regex.

---

# IMPORTANT IMPLEMENTATION RULES

Before changing code:

1. Read the repository instructions:
   - `CLAUDE.md`
   - `public/frontend/CLAUDE.md`
   - `public/frontend/AGENTS.md`
   - any relevant `.claude/*` instructions.

2. Inspect the existing implementation before editing it.

3. Do not assume the screenshots correspond to the current route names.

4. Do not simply patch the visible UI. Trace the full data flow:
   - registration
   - stored enrollment
   - email validation
   - email verification
   - login lookup
   - location acquisition
   - backend geofence verification
   - navigation
   - public verification input
   - FAQ routing.

5. Do not introduce a second competing implementation.

6. Prefer the existing API/client/service architecture instead of creating ad-hoc fetches.

7. Do not use New Delhi, `28.6139`, `77.2090`, or any other location as a hidden fallback.

8. Never treat browser geolocation failure as successful location verification.

9. Do not weaken biometric or authentication checks merely to make login pass.

10. Do not disable clipboard/keyboard protection globally. Scope exam anti-cheat controls only to routes where they are actually required.

11. Preserve existing dev/mock functionality, but mock behavior must be explicit and must never silently masquerade as real geographic, email, or identity verification.

12. Do not make unrelated UI redesigns.

13. Do not call an email address "real" merely because:
   - it matches an email regex;
   - its domain exists;
   - the domain has MX records.

Those checks can be useful signals, but ownership should be verified by an email challenge/OTP or verification link.

---

# PHASE 1 — REPOSITORY AUDIT

Before editing, search the entire repository for:

```text
New Delhi
new delhi
Delhi
28.6139
77.2090
hard-coded
hardcoded
geofence
geolocation
getCurrentPosition
navigator.geolocation
Location
center_id
centre_id
within_center_bounds
verifyGeofence
InvigilatorEnrollment
saveEnrollment
getEnrollment
localStorage
clipboard
navigator.clipboard
onPaste
onKeyDown
preventDefault
FAQ
Faq
/faq
email
emailRegex
emailRegex
email validation
verifyEmail
email verification
otp
verification code
magic link
disposable
temporary email
fake email
invalid email
MX
mail exchanger
SMTP
```

Also search for:

```text
EXAM ID
UUID
Public Exam Verification
Verify an Exam
Paste the Exam ID
```

Do not assume the public-verification screenshot is implemented by:

`public/frontend/app/exam/verify/[examId]/page.tsx`

That route currently represents a pre-exam verification wizard. Find the actual route/component producing the screenshot.

Create a short internal map before modifying code:

```text
Invigilator Registration:
route →
page/component →
email validation →
email verification →
API →
storage →
schema/model

Invigilator Login:
route →
component →
email/staff lookup →
enrollment lookup →
geolocation →
backend geofence →
biometric checks →
success/failure

Public verification:
route →
page/component →
input component →
submit handler →
API

FAQ:
source component →
href/onClick →
route →
middleware/redirect behavior
```

Then implement the fixes below.

---

# PHASE 2 — FIX INVIGILATOR LOCATION ARCHITECTURE

## 2.1 Remove all hard-coded Delhi location logic

Current registration code contains a visible hard-coded location:

```text
Location: CryptoExam Center New Delhi (hard-coded)
```

Current login code also contains a dangerous fallback equivalent to:

```ts
latitude: coords?.latitude ?? 28.6139
longitude: coords?.longitude ?? 77.2090
```

Remove both behaviors.

There must be no code path where:

```text
geolocation failed → use New Delhi → continue verification
```

That is incorrect.

---

# PHASE 3 — USE AN AUTHORITATIVE EXAM-CENTRE LOCATION

Do NOT make the browser's current location the permanent security anchor.

The correct model is:

```text
Centre record
    ↓
centre_id
    ↓
authoritative latitude
authoritative longitude
authoritative radius
centre name/state
    ↓
invigilator enrollment references centre_id
    ↓
login captures LIVE browser location
    ↓
backend compares LIVE location against CENTRE location
```

This prevents someone from simply enrolling at an arbitrary location and later treating that arbitrary location as a legitimate examination centre.

## 3.1 Add centre identity to invigilator enrollment

Inspect the existing centre models/API first.

Reuse the existing centre model and API if possible.

Add an authoritative field such as:

```ts
centerId: string
```

or the repository's existing naming convention.

The enrollment should conceptually contain:

```ts
interface InvigilatorEnrollment {
    staffId: string;
    fullName: string;

    centerId: string;

    faceDescriptor: number[];
    faceDetectionScore: number;

    fingerprint: FingerprintCredential | null;

    ip: string;
    ipSource: string;
    userAgent: string;

    registeredAt: string;

    emailVerified: boolean;
    emailVerifiedAt: string | null;
}
```

Do not duplicate the centre's latitude/longitude into the browser enrollment if the backend can resolve it from `centerId`.

The server should remain authoritative for centre coordinates and geofence radius.

---

# PHASE 4 — FIX INVIGILATOR REGISTRATION FLOW

Inspect:

```text
public/frontend/app/invigilator/register/page.tsx
public/frontend/app/staff-registration/page.tsx
public/frontend/lib/biometric/enrollment.ts
public/frontend/lib/api/invigilator.ts
public/frontend/lib/api/staff.ts
public/backend/app/api/v1/
```

There are currently two conceptually different staff-registration flows.

One is `/invigilator/register`, which stores biometric enrollment locally.

Another is the public `/staff-registration` flow, which interacts with the backend/centre process.

Do not leave these two flows inconsistently implementing the same identity-registration process.

Determine which is the canonical production flow.

If `/staff-registration` is the authoritative backend workflow, the invigilator login registration link should lead into that flow rather than creating an unrelated browser-only identity.

If `/invigilator/register` is intentionally retained as a development/demo enrollment flow, make that distinction explicit and ensure production login does not trust local storage as a substitute for authoritative enrollment.

---

# PHASE 5 — CENTRE SELECTION DURING REGISTRATION

The registration flow must know which examination centre the invigilator belongs to.

Use the existing centre API rather than hard-coding a centre.

Provide a centre selector such as:

```text
Examination Centre
[ Select centre ▼ ]
```

Load it from the existing centre API.

Do not hard-code:

```text
CryptoExam Center New Delhi
```

The displayed value must come from the actual centre record.

When registration begins, validate:

```text
fullName
staff email
centre
face
```

before proceeding.

On successful registration the stored enrollment must contain the chosen `centerId`.

---

# PHASE 6 — FIX EMAIL AUTHENTICITY / FAKE EMAIL DETECTION

## 6.1 Identify the current flaw

The current invigilator login contains validation equivalent to:

```ts
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffId)) {
    setError('Enter a valid staff email.');
    return;
}
```

That only validates **syntax**.

It does NOT prove:

```text
mailbox exists
person controls mailbox
domain is trustworthy
email is not disposable
email is not temporary
```

Do not describe this as "fake email detection" after the fix unless the system actually verifies ownership.

The implementation must distinguish at least:

```text
Format valid
Domain valid
Disposable/temporary check
Email ownership verified
Account/enrollment approved
```

---

## 6.2 Use server-side email verification

Preferred flow:

```text
User enters email
        ↓
Frontend basic format validation
        ↓
Backend validates/normalizes email
        ↓
Optional domain/MX/disposable checks
        ↓
Generate short-lived verification challenge
        ↓
Send OTP or verification link to that address
        ↓
User proves access to mailbox
        ↓
Backend marks email_verified = true
        ↓
Only then allow invigilator enrollment/login
```

The frontend must NOT set:

```ts
emailVerified = true
```

The backend/database must be authoritative.

---

## 6.3 Add explicit verification state

Use an explicit account state such as:

```ts
email_verified: boolean
email_verified_at: datetime | null
```

If the existing system uses a different naming convention, follow it.

Do not infer verification status from:

```text
email exists in localStorage
email matches regex
email was previously typed
```

The state must come from the backend.

---

## 6.4 Generate secure verification challenges

Inspect the existing OTP/TOTP implementation first.

If an email OTP already exists, reuse it where appropriate.

If not, create a dedicated email verification challenge.

The backend should generate a cryptographically secure random token/code.

Requirements:

```text
short expiry
single use
server-side storage/hash where appropriate
maximum verification attempts
rate limiting
invalidated after successful verification
```

Example lifecycle:

```text
create verification challenge
        ↓
store challenge + expiry + attempt count
        ↓
send email
        ↓
user submits code
        ↓
constant-time / secure comparison
        ↓
mark email verified
        ↓
delete/invalidate challenge
```

Do not store a long-lived plaintext verification token unnecessarily.

---

# PHASE 7 — DISPOSABLE / TEMPORARY EMAIL DETECTION

Disposable email detection should be treated as an **additional fraud-control layer**, not as proof that a mailbox is fake.

Add server-side checking for known disposable/temporary domains.

Conceptually:

```text
user@example.com
        ↓
extract domain
        ↓
normalize domain
        ↓
check disposable-domain blocklist
        ↓
if disposable → reject or flag
        ↓
otherwise continue to ownership verification
```

The blocklist should be maintained centrally and updated using the repository's existing dependency/configuration strategy.

Do not hard-code a tiny list of 5–10 domains and call the problem solved.

If a third-party or maintained disposable-domain dataset is used:

- pin a safe package/version;
- inspect its license;
- update it through a documented process;
- add a local override mechanism if the project needs custom blocked domains;
- provide a whitelist mechanism for legitimate domains that would otherwise be false positives.

---

# PHASE 8 — DOMAIN / MX CHECK

Add an optional server-side domain sanity check before sending verification mail.

Check whether the domain appears capable of receiving mail.

However:

```text
MX exists
≠
mailbox exists
```

and:

```text
domain exists
≠
person owns the mailbox
```

Therefore MX/domain checks can only be used as a preliminary signal.

Do NOT reject every email merely because an MX lookup cannot be completed transiently.

Handle infrastructure failures separately from a confirmed invalid domain.

Use explicit statuses such as:

```text
valid_format
domain_valid
disposable
mail_delivery_unknown
ownership_verified
```

rather than a single boolean called `isRealEmail`.

---

# PHASE 9 — INVIGILATOR EMAIL OWNERSHIP FLOW

For a new invigilator:

```text
Step 1:
Enter staff email

Step 2:
Backend creates email verification challenge

Step 3:
Verification email is sent

Step 4:
User enters verification code
OR
opens verification link

Step 5:
Backend validates challenge

Step 6:
email_verified = true

Step 7:
Only now continue to biometric enrollment

Step 8:
Associate verified email with centre and enrollment
```

The biometric enrollment should not become a fully trusted invigilator identity before email ownership is verified.

---

# PHASE 10 — LOGIN EMAIL HANDLING

At invigilator login:

1. Normalize the submitted email.
2. Perform format validation.
3. Query the authoritative backend enrollment.
4. Reject unknown identities.
5. Reject identities whose email has not been verified.
6. Only then begin:
   - location verification;
   - face verification;
   - fingerprint verification;
   - OTP/session creation.

Expected order:

```text
email
 ↓
authoritative lookup
 ↓
email_verified?
 ↓
location
 ↓
face
 ↓
fingerprint
 ↓
OTP
 ↓
session
```

Do not make the browser perform a "fake email detection" check and then trust itself.

---

# PHASE 11 — EMAIL NORMALIZATION

Normalize input consistently on both registration and login.

At minimum:

```ts
email.trim().toLowerCase()
```

Do not implement provider-specific transformations such as removing Gmail dots or plus-tags unless there is a deliberate security/business requirement.

A user identity comparison should use the same canonical representation throughout the system.

Add tests for:

```text
" user@example.com "
"USER@EXAMPLE.COM"
"user@example.com"
```

and verify they resolve consistently.

---

# PHASE 12 — PREVENT ACCOUNT ENUMERATION

Do not expose unnecessary information to unauthenticated users.

Avoid responses such as:

```text
This email exists
This email does not exist
This account belongs to another centre
```

where that information could be abused for account enumeration.

For email-verification requests, use appropriately generic responses such as:

```text
If this address can be used for registration, a verification code has been sent.
```

For an actual authenticated invigilator login, the UI can show a useful error, but backend APIs should avoid leaking sensitive enrollment details.

---

# PHASE 13 — RATE LIMIT EMAIL VERIFICATION

Protect the verification endpoints against abuse.

Rate-limit:

```text
request verification email
verify OTP/code
resend verification email
```

Rate limiting should consider at least:

```text
IP
email address
challenge/session identifier
```

with reasonable limits.

Do not create an unbounded "resend code" endpoint.

Add a cooldown and maximum attempts.

---

# PHASE 14 — EMAIL VERIFICATION TESTS

Add backend tests for:

1. Valid email format.
2. Invalid email format.
3. Valid domain.
4. Clearly invalid/nonexistent domain.
5. Disposable email domain.
6. Non-disposable domain.
7. Verification code generated.
8. Verification email sent through configured email service.
9. Correct verification code → success.
10. Wrong verification code → failure.
11. Expired code → failure.
12. Reused code → failure.
13. Excessive attempts → blocked.
14. Excessive resend requests → rate limited.
15. Email becomes `email_verified = true` only after successful verification.
16. Unverified invigilator cannot complete trusted enrollment.
17. Unverified invigilator cannot log in.
18. Changing email resets verification state.
19. Upper/lowercase/whitespace normalization works consistently.
20. Production login never trusts an unverified `localStorage` email/enrollment.

---

# PHASE 15 — EMAIL SERVICE / DEVELOPMENT MODE

Inspect the existing email infrastructure.

If the application already has an email provider abstraction, reuse it.

Do not place SMTP/API credentials in frontend code.

Development mode may use a mock mail provider, but the verification workflow must remain logically identical:

```text
create challenge
→ send/mock email
→ enter code
→ backend verifies
→ mark verified
```

Do NOT simply auto-verify every email in mock mode unless the environment is explicitly a test fixture and the behavior is isolated from production configuration.

A development bypass must be obvious from configuration and impossible to activate accidentally in production.

---

# PHASE 16 — DATABASE / MODEL CHANGES FOR EMAIL

If the existing user/invigilator table already contains email fields, extend it rather than duplicating identity tables.

Potential fields:

```text
email
email_normalized
email_verified
email_verified_at
```

Verification challenge data should be kept separate where appropriate:

```text
email_verification_challenge
    id
    user/invigilator id
    challenge hash
    expires_at
    attempts
    created_at
    consumed_at
```

Follow the repository's existing migration mechanism.

Do not destroy existing staff records.

For existing legacy records with no `email_verified` state, choose an explicit migration policy:

```text
legacy records become unverified
```

or another documented policy approved by the current application rules.

Do not silently assume all old emails are verified.

---

# PHASE 17 — PUBLIC EXAM VERIFICATION INPUT BUG

The screenshot shows:

```text
Public Exam Verification

Verify an Exam

EXAM ID (UUID)

[ e.g., a1b2c3d4-5678-90ab-cdef-1234567890ab ]
```

The input currently cannot be reliably typed/pasted.

First locate the exact current implementation using repository-wide search.

Do not modify the unrelated:

```text
/exam/verify/[examId]
```

route unless the audit proves it is the actual page shown in the screenshot.

---

# PHASE 18 — AUDIT THE INPUT COMPONENT

For the actual public verification page, verify all of the following:

### HTML

The input must be something equivalent to:

```tsx
<input
    type="text"
    value={examId}
    onChange={(e) => setExamId(e.target.value)}
    ...
/>
```

It must NOT have:

```text
disabled
readOnly
```

unless explicitly required.

Do not accidentally pass:

```text
readOnly={someUndefinedOrWrongState}
```

or:

```text
disabled={loading}
```

for the entire lifecycle.

---

# PHASE 19 — REMOVE INPUT EVENT INTERFERENCE

Search the verification page and its ancestors for:

```text
onKeyDown
onKeyPress
onKeyUp
onPaste
onBeforeInput
preventDefault
stopPropagation
clipboard
navigator.clipboard
keydown
paste
```

Make sure no global security/anti-cheat handler is suppressing input.

Particularly inspect:

```text
public/frontend/app/layout.tsx
```

and any shared client-side providers/hooks/components.

Public verification is NOT an exam session.

Therefore:

```text
Public verification
→ ordinary keyboard + clipboard behavior

Actual exam session
→ anti-cheat restrictions
```

Do not apply exam-session clipboard suppression globally.

---

# PHASE 20 — PASTE TEST

The input must support all of:

```text
Ctrl + V
Cmd + V
Right click → Paste
Keyboard typing
Browser autofill/input
```

Do not implement custom clipboard code unless absolutely necessary.

Normal browser input behavior should be sufficient.

If a custom `onPaste` exists only for validation, it should not block valid input.

---

# PHASE 21 — VALIDATE ON SUBMIT, NOT ON EVERY CHARACTER

Use controlled input state.

Allow users to enter a UUID normally.

Validation should happen when the user submits, e.g.:

```ts
const normalized = examId.trim();

if (!UUID_REGEX.test(normalized)) {
    setError("Enter a valid Exam ID.");
    return;
}
```

Do not clear the input while the user is typing.

Do not reject intermediate typing states.

A pasted full UUID should be accepted immediately.

---

# PHASE 22 — UUID VALIDATION

Use a reasonable UUID validator.

For example:

```text
xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Do not require lowercase.

Normalize:

```ts
examId.trim()
```

before lookup.

If the backend is case-insensitive, preserve the user's input visually and normalize only for lookup.

---

# PHASE 23 — PUBLIC VERIFICATION BACKEND FLOW

After input is accepted:

```text
user enters Exam ID
        ↓
submit
        ↓
trim + validate UUID
        ↓
API request
        ↓
backend verifies exam
        ↓
show verification result
```

Do not make the input field itself responsible for blockchain verification.

Return clear states:

```text
idle
loading
verified
not found
invalid UUID
backend unavailable
```

---

# PHASE 24 — FAQ BUG

Search the entire repository for:

```text
FAQ
Faq
faq
Frequently Asked Questions
```

Locate every relevant FAQ control.

Inspect:

```text
href
onClick
button type
router.push
router.replace
redirect()
middleware
fallback routes
```

The current navigation implementation should also be checked because the current site map does not expose an FAQ route.

---

# PHASE 25 — CREATE A REAL FAQ ROUTE

If no canonical FAQ route exists, create:

```text
public/frontend/app/faq/page.tsx
```

Use the same visual language as the rest of the public site.

The page should contain a real FAQ interface rather than redirecting somewhere else.

At minimum include useful categories such as:

```text
Candidates
Invigilators
Centre administration
Question setters
Public exam verification
Biometrics and privacy
Blockchain verification
```

Do not create fake functionality.

---

# PHASE 26 — FIX FAQ LINKING

Every FAQ link should use:

```tsx
<Link href="/faq">
```

or the equivalent routing mechanism.

Do NOT use:

```text
href="/"
router.push("/")
router.replace("/")
```

for an FAQ action.

If FAQ is currently inside a form:

```html
<button>
```

make sure it is:

```html
<button type="button">
```

unless it genuinely submits the form.

A navigation button must not accidentally submit an unrelated form.

---

# PHASE 27 — NAVIGATION SINGLE SOURCE OF TRUTH

Since this repository already uses:

```text
public/frontend/lib/navigation.ts
```

as the site-wide navigation source, add FAQ there rather than creating disconnected links.

Place it logically under the learning/information section.

Example conceptually:

```ts
{
    title: "FAQ",
    href: "/faq",
    desc: "Frequently asked questions about CryptoExam Core.",
    icon: "circle-help",
    keywords: ["faq", "help", "questions", "support"]
}
```

This lets the existing navigation surfaces stay synchronized.

Do not manually duplicate an FAQ link in multiple unrelated components unless necessary.

---

# PHASE 28 — CHECK FOR FLOATING LANGUAGE SELECTOR INTERFERENCE

The supplied screenshot shows a language selector around the affected page.

Inspect whether the language selector or its container is:

```text
position: absolute
position: fixed
pointer-events
z-index
```

or sitting on top of interactive controls.

Make sure the language selector cannot visually overlay or intercept clicks intended for:

```text
FAQ
Exam ID input
Submit buttons
```

Use browser DevTools-style reasoning:

```text
visible element
↓
actual hit-test element
↓
pointer-events
↓
z-index
```

Fix only the actual layering problem if one exists.

Do not arbitrarily change z-index values across the entire site.

---

# PHASE 29 — TEST PLAN

Create or update automated tests for the affected logic.

## Location tests

Test:

1. Valid centre + valid coordinates inside radius → success.
2. Valid centre + coordinates outside radius → failure.
3. Geolocation denied → login remains on location step.
4. Geolocation timeout → login remains on location step.
5. Geolocation unavailable → login remains on location step.
6. No coordinates returned → never substitute Delhi.
7. Unknown centre ID → backend rejects.
8. Client attempts to submit fake centre coordinates → backend ignores them and uses authoritative centre data.
9. Multiple centres return distinct centre names/coordinates.
10. Registration persists the correct centre ID.

## Enrollment tests

Test:

```text
server enrollment exists
server enrollment missing in production
mock/local enrollment in mock mode
```

Ensure production does not silently trust unrelated localStorage data.

## Email authenticity tests

Test:

```text
format-invalid email
nonexistent domain
valid domain with MX
disposable/temporary domain
verification email generation
verification code success
wrong verification code
expired code
reused code
too many attempts
too many resend requests
unverified email login
verified email login
changed email resets verification
case/whitespace normalization
production does not trust localStorage email verification state
```

---

# PHASE 30 — PUBLIC EXAM VERIFICATION TESTS

Test:

1. User can type one character at a time.
2. User can paste a complete UUID using Ctrl+V.
3. User can paste using right-click.
4. User can paste using Cmd+V on macOS.
5. Input is not readonly.
6. Input is not disabled during normal operation.
7. Invalid UUID shows validation error.
8. Valid UUID reaches the API.
9. Leading/trailing whitespace is handled.
10. Loading state does not permanently disable input.
11. Global anti-cheat keyboard listeners do not affect the page.
12. Browser context-menu behavior is not unnecessarily disabled on this public page.

---

# PHASE 31 — FAQ TESTS

Test:

1. Clicking FAQ opens `/faq`.
2. Direct navigation to `/faq` works.
3. Refreshing `/faq` works.
4. FAQ does not redirect to `/`.
5. FAQ does not submit any surrounding form.
6. FAQ is accessible from every intended navigation surface.
7. Back/forward browser navigation works.
8. Mobile FAQ navigation works.
9. Any language selector does not intercept FAQ clicks.
10. No stale `/faq` → `/` redirect remains in middleware or routing code.

---

# PHASE 32 — BUILD AND STATIC CHECKS

After implementation:

### Frontend

Run from:

```text
public/frontend
```

at minimum:

```bash
npm run build
```

and:

```bash
npm run lint
```

if available.

Also run:

```bash
npm run typecheck
```

if the project provides that script.

### Backend

From:

```text
public/backend
```

run the repository's available test suite, for example:

```bash
pytest
```

or the actual configured test command.

Do not assume the command exists; inspect `package.json` and backend configuration first.

---

# PHASE 33 — MANUAL BROWSER TEST

Run the application locally using the repository's documented startup method.

Test the complete flow in a real browser.

## Invigilator registration

Expected:

```text
Full name
Email
Centre
Email verification
Face
Fingerprint
Device/IP
Complete
```

The location/centre must show the actual selected centre.

It must never display:

```text
New Delhi (hard-coded)
```

unless New Delhi was genuinely selected as the centre.

The invigilator must not become trusted before email ownership is verified.

## Invigilator login

Expected:

```text
Email
↓
Authoritative enrollment lookup
↓
Email verification state
↓
Location & Network
↓
Face
↓
Fingerprint
↓
OTP
↓
Dashboard
```

When the email has not been verified:

```text
STOP before biometric authentication
```

When location is denied:

```text
STOP at Location & Network
```

When location is outside the centre:

```text
STOP at Location & Network
```

When location is inside:

```text
CONTINUE to Face
```

---

# PHASE 34 — DO NOT BREAK EXISTING FLOWS

After the changes, verify that these still work:

```text
Candidate login
Candidate enrolment
Setter login
Admin login
Invigilator login
Centre admin approval
Candidate public verification
Exam pages
Footer navigation
Header navigation
Command palette
```

Do not remove existing biometric verification.

Do not disable WebAuthn.

Do not bypass face matching.

Do not convert the system back into a purely mocked authentication flow.

---

# PHASE 35 — CODE QUALITY REQUIREMENTS

Keep changes focused.

Prefer reusable helpers where appropriate, for example:

```text
getCurrentBrowserLocation()
calculateDistanceMeters()
getAuthoritativeCentre()
normalizeEmail()
validateEmailDomain()
isDisposableEmail()
createEmailVerificationChallenge()
verifyEmailChallenge()
```

Do not duplicate geolocation or email-verification logic in several pages.

Keep security-sensitive rules on the backend.

Keep UI state handling on the frontend.

Use strong TypeScript types for:

```text
centre
coordinates
geofence result
enrollment
email verification state
email verification challenge
verification state
```

Avoid:

```text
any
silent catch blocks
fake defaults
magic coordinates
magic centre names
email = verified merely because regex passed
```

unless there is a documented reason.

---

# PHASE 36 — FINAL SECURITY AUDIT

Before declaring the work complete, search again for:

```text
28.6139
77.2090
New Delhi
hard-coded
navigator.geolocation
onPaste
preventDefault
clipboard
/faq
router.push("/")
emailVerified = true
isValidEmail
emailRegex
disposable
MX
```

Verify:

- no New Delhi geographic fallback remains;
- no missing-geolocation success path remains;
- no unrelated clipboard suppression affects public verification;
- no FAQ action points to `/`;
- no duplicate competing invigilator enrollment implementation remains accidentally active;
- no frontend-only "fake email detection" is being treated as proof of mailbox ownership;
- unverified emails cannot become trusted invigilator identities;
- disposable email handling is server-side;
- email verification challenges expire and cannot be reused;
- rate limiting exists for email verification actions.

---

# REQUIRED FINAL REPORT FROM CLAUDE CODE

When the implementation is complete, report:

## 1. Root causes found

For each of the **four** problems, state the exact root cause.

## 2. Files changed

List every changed file with a one-line explanation.

## 3. Location architecture

Explain:

```text
where centre coordinates come from
where centre_id is stored
how browser location is captured
where geofence is calculated
what happens when permission is denied
```

## 4. Email authenticity architecture

Explain:

```text
what the old email check was doing
why it accepted fake/non-existent emails
how email format is checked
how domain/disposable checks work
how mailbox ownership is verified
where verification state is stored
how OTP/link expiry works
how rate limiting works
why production cannot bypass verification
```

## 5. Public verification input

Explain what was preventing:

```text
typing
Ctrl+V
right-click paste
```

and what was changed.

## 6. FAQ routing

Explain:

```text
old destination
new destination
why it was redirecting to home
whether /faq was newly created
```

## 7. Tests executed

Include exact commands and results.

## 8. Remaining limitations

Do not hide anything that could still fail in production.

---

# DEFINITION OF DONE

The task is NOT complete until all of these are true:

- [ ] No invigilator registration page displays a hard-coded New Delhi location.
- [ ] No login path substitutes New Delhi coordinates.
- [ ] Centre identity is authoritative and associated with the invigilator.
- [ ] Login uses live browser geolocation.
- [ ] Geolocation failure blocks verification rather than guessing.
- [ ] Backend performs the authoritative geofence calculation.
- [ ] Production login does not silently trust unrelated localStorage enrollment.
- [ ] Email validation is not limited to a frontend regex.
- [ ] Email domain/disposable checks are performed server-side where applicable.
- [ ] Invigilator email ownership is verified through OTP or verification link.
- [ ] Unverified invigilators cannot become trusted enrollments.
- [ ] Unverified invigilators cannot complete login.
- [ ] Email verification challenges expire.
- [ ] Verification challenges cannot be reused.
- [ ] Email verification endpoints are rate limited.
- [ ] Public Exam Verification Exam ID can be typed normally.
- [ ] Public Exam Verification Exam ID can be pasted with Ctrl+V/Cmd+V.
- [ ] Public verification is not affected by exam-session clipboard suppression.
- [ ] FAQ opens a real `/faq` route.
- [ ] FAQ does not submit an unrelated form.
- [ ] FAQ does not redirect to `/`.
- [ ] FAQ is integrated into the repository's navigation source of truth.
- [ ] Frontend builds successfully.
- [ ] Backend tests pass.
- [ ] Email verification tests pass.
- [ ] Manual browser testing confirms all four reported issues are fixed.
- [ ] No unrelated functionality was broken.