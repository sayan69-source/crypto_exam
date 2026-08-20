# CryptoExam Core — Mandatory Email OTP Verification Across Login and Contact

Repository:

`https://github.com/sayan69-source/crypto_exam`

Production frontend:

`https://cryptoexam-web-sayan-db3y.onrender.com`

Branch:

`main`

## PRIMARY OBJECTIVE

Implement a **real server-side email OTP verification system** and make it mandatory for the following four public flows:

1. Invigilator login
   - `/login?role=invigilator`

2. Setter login
   - `/login?role=setter`

3. Admin login
   - `/login?role=admin`

4. Contact form
   - `/contact`

The requirement is strict:

> When a user enters an email address, the system must send a one-time verification code to that exact email address. The user must enter the code correctly. Only after the backend confirms that the submitted OTP matches the OTP sent to that email may the email be considered verified for that login/contact attempt.

A string that merely looks like an email address must NEVER be considered verified.

For example:

```text
abc@example.com
```

may pass syntax validation, but it is not accepted as verified until the user receives the OTP at `abc@example.com` and enters the correct code.

Do NOT attempt to solve this using only:

```text
regex
HTML type="email"
domain existence
DNS
MX records
disposable-email lists
```

Those are supplementary checks only.

The actual ownership/access proof must be:

```text
OTP sent to exact email
        ↓
OTP received by user
        ↓
correct OTP entered
        ↓
server verifies OTP
        ↓
email verification grant issued
        ↓
protected action allowed
```

---

# 1. EXISTING SYSTEM AUDIT — DO THIS BEFORE EDITING

Read all repository instructions first:

```text
CLAUDE.md
public/frontend/CLAUDE.md
public/frontend/AGENTS.md
.claude/*
```

Then inspect the current implementation before modifying it.

Known relevant files include:

```text
public/frontend/components/auth/InvigilatorLoginForm.tsx
public/frontend/components/auth/SetterLoginForm.tsx
public/frontend/components/auth/AdminLoginForm.tsx

public/frontend/app/contact/page.tsx

public/frontend/lib/api/client.ts

public/backend/app/api/v1/auth.py
public/backend/app/api/v1/contact.py

public/backend/app/services/email.py
public/backend/app/services/sms.py

public/backend/app/models/__init__.py
public/backend/app/config.py
```

Also inspect:

```text
public/backend/app/api/v1/__init__.py
public/backend/app/main.py
public/backend/app/database.py
public/backend/app/schemas/*
public/backend/app/services/*
public/frontend/lib/api/types.ts
```

Search the complete repository for:

```text
email
EmailStr
email validation
email_verified
verification
OTP
otp
OtpChallenge
send_email
SMTP
dev_preview
dev_code
DEBUG
contact
/auth/login
/auth/verify-otp
```

Create a written implementation map before editing:

```text
Invigilator:
email input
→ email OTP request
→ email OTP verification
→ verified grant
→ enrollment lookup
→ geolocation
→ face
→ fingerprint
→ existing final OTP
→ dashboard

Setter:
email input
→ email OTP request
→ email OTP verification
→ verified grant
→ password verification
→ existing phone OTP
→ dashboard

Admin:
email input
→ email OTP request
→ email OTP verification
→ verified grant
→ password verification
→ existing phone OTP
→ dashboard

Contact:
email input
→ email OTP request
→ email OTP verification
→ verified grant
→ contact submission
→ acknowledgement
```

Do not start coding until the existing flow is understood.

---

# 2. IMPORTANT SECURITY REQUIREMENT

The frontend must NEVER be allowed to declare:

```ts
emailVerified = true
```

and have the backend trust it.

This is unacceptable:

```json
{
  "email": "someone@example.com",
  "email_verified": true
}
```

The backend must prove verification independently.

The browser should receive an **opaque, short-lived verification grant/token** after successful OTP verification.

That grant must be:

```text
server-issued
short-lived
bound to exact email
bound to exact purpose
bound to exact role where applicable
single-use
not forgeable
not reusable
```

The next protected request must present that grant to the backend.

---

# 3. DO NOT REUSE THE EXISTING PHONE OTP AS EMAIL VERIFICATION

The repository already has a phone OTP mechanism for setter/admin login.

Do NOT simply rename or reuse it.

The current phone OTP system is logically different:

```text
password
↓
phone OTP
↓
JWT
```

The new flow must be:

```text
email
↓
EMAIL OTP
↓
email verified
↓
existing authentication factors
```

Setter/admin should ultimately have:

```text
Email OTP
+
Password
+
Existing phone OTP
```

Invigilator should ultimately have:

```text
Email OTP
+
Existing enrollment verification
+
Location
+
Face
+
Fingerprint/WebAuthn
+
Existing final authentication/OTP mechanism
```

Do not remove the existing phone OTP from setter/admin simply because email OTP has been added.

---

# 4. DESIGN A DEDICATED EMAIL OTP SYSTEM

Create a dedicated email verification challenge model.

Do NOT use the existing `OtpChallenge` blindly because it is specifically designed around registered phone numbers.

Prefer a dedicated model such as:

```text
EmailOtpChallenge
```

with fields conceptually equivalent to:

```python
id
email
purpose
role
code_hash
expires_at
attempts
max_attempts
consumed_at
created_at
delivery_status
request_ip
```

Possible fields:

```text
id: UUID/string
email: normalized email
purpose: LOGIN | CONTACT
role: INVIGILATOR | SETTER | ADMIN | null
code_hash: secure hash/HMAC
expires_at
attempts
consumed
created_at
last_sent_at
request_ip
```

Use the repository's existing SQLAlchemy conventions.

Do not invent a second database architecture.

---

# 5. EMAIL OTP MUST BE PURPOSE-BOUND

An OTP requested for:

```text
LOGIN
```

must not work for:

```text
CONTACT
```

An OTP requested for:

```text
SETTER LOGIN
```

must not work for:

```text
ADMIN LOGIN
```

An OTP requested for:

```text
INVIGILATOR LOGIN
```

must not work for:

```text
SETTER LOGIN
```

Therefore every challenge must contain a `purpose` and, for login, a role/context.

For example:

```text
purpose = LOGIN
role = ADMIN
email = admin@example.com
```

must only authorize:

```text
ADMIN login
```

---

# 6. EMAIL NORMALIZATION

Create one backend helper:

```text
normalize_email()
```

Use it everywhere.

At minimum:

```python
email.strip().lower()
```

The following must resolve to the same canonical email:

```text
user@example.com
USER@EXAMPLE.COM
 user@example.com
```

Do not apply provider-specific transformations such as removing Gmail dots or plus-tags.

Do not modify the actual mailbox identity beyond safe normalization.

Frontend and backend should both normalize, but the backend is authoritative.

---

# 7. OTP GENERATION

Generate a cryptographically secure six-digit code.

Example:

```text
000000–999999
```

Use a secure random source such as:

```python
secrets.randbelow(1_000_000)
```

Do NOT use:

```text
Math.random()
random.random()
timestamps
incrementing values
user IDs
```

The cleartext OTP must never be stored in the database in production.

Prefer storing:

```text
HMAC-SHA256(code, server_secret)
```

or another secure verification representation.

Do not rely on plain SHA-256 of a six-digit code without a server-side secret because OTPs have very low entropy.

---

# 8. OTP CONFIGURATION

Add dedicated environment-backed configuration.

Example:

```text
EMAIL_OTP_TTL_SECONDS=300
EMAIL_OTP_MAX_ATTEMPTS=5
EMAIL_OTP_RESEND_COOLDOWN_SECONDS=60
EMAIL_OTP_MAX_SENDS_PER_HOUR=5
EMAIL_OTP_SECRET=<strong-random-secret>
```

Use safe defaults:

```text
TTL: 5 minutes
Attempts: 5
Resend cooldown: approximately 60 seconds
```

All values should be configurable.

Do not hard-code production security limits.

---

# 9. OTP REQUEST ENDPOINT

Create a backend endpoint similar to:

```text
POST /api/v1/email-verification/request
```

or follow the repository's naming conventions.

Request body:

```json
{
  "email": "user@example.com",
  "purpose": "LOGIN",
  "role": "ADMIN"
}
```

For contact:

```json
{
  "email": "user@example.com",
  "purpose": "CONTACT"
}
```

The backend should:

1. Normalize email.
2. Validate email syntax.
3. Apply rate limits.
4. Invalidate or supersede previous active challenges for the same verification context.
5. Generate a new secure OTP.
6. Store only the secure OTP representation.
7. Set expiration.
8. Send OTP to the exact normalized email address.
9. Return only a challenge identifier/context identifier.
10. NEVER return the OTP itself in production.

Response:

```json
{
  "challenge_id": "...",
  "expires_in": 300,
  "resend_after": 60
}
```

Do NOT return:

```json
{
  "otp": "123456"
}
```

in production.

---

# 10. DO NOT EXPOSE DEV OTP IN PRODUCTION

This is critical.

The current repository's shared email service has a development fallback where the composed email may be returned through the API when SMTP is not configured, and SMTP failures can also fall back to a development preview.

Do NOT use that behavior for email verification.

For an OTP endpoint:

```text
SMTP configured and delivery succeeds
→ continue

SMTP not configured in production
→ fail

SMTP delivery fails in production
→ fail

Never:
SMTP failure
→ return OTP/dev preview
→ allow verification
```

Introduce a strict email delivery mode for authentication/security OTPs.

For example:

```python
send_email(
    ...,
    critical=True,
    allow_dev_preview=False,
)
```

or create:

```text
send_security_otp_email()
```

that always fails closed.

Development may optionally support a visible dev OTP, but ONLY when:

```text
DEBUG=true
AND
explicit EMAIL_OTP_DEV_MODE=true
```

Never activate this automatically just because SMTP is missing.

Production must never expose:

```text
dev_code
dev_preview
SMTP-FAILED preview
OTP
```

through the API.

---

# 11. FIX THE EXISTING EMAIL SERVICE

Inspect:

```text
public/backend/app/services/email.py
```

Keep the shared service, but modify its behavior so security-sensitive email has a strict path.

Current behavior effectively allows:

```text
SMTP missing
→ dev preview

SMTP failed
→ dev preview
```

That is unacceptable for authentication OTP.

Implement a distinction between:

```text
ordinary application email
security email
```

Security email must:

```text
fail closed
never expose content
never expose OTP
```

Also ensure production logs do not contain the full OTP or email body.

---

# 12. SMTP / EMAIL PROVIDER CONFIGURATION

The deployed Render backend must have real email delivery configured.

Use the existing SMTP abstraction unless there is a strong reason to replace it.

Add Render environment variables:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
```

Also add:

```text
EMAIL_OTP_SECRET
DEBUG=false
EMAIL_OTP_DEV_MODE=false
```

Do not put SMTP credentials into:

```text
Next.js frontend
NEXT_PUBLIC_* variables
GitHub repository
client-side JavaScript
```

Only the backend should have SMTP credentials.

Use a proper transactional email provider/SMTP service in production.

If using a custom sending domain, configure the appropriate SPF/DKIM/DMARC records so OTP delivery is reliable.

---

# 13. EMAIL OTP VERIFY ENDPOINT

Create:

```text
POST /api/v1/email-verification/verify
```

Request:

```json
{
  "challenge_id": "...",
  "email": "user@example.com",
  "code": "123456"
}
```

Backend must:

1. Load challenge.
2. Confirm it exists.
3. Confirm it has not expired.
4. Confirm it is not consumed.
5. Confirm attempts remain.
6. Normalize submitted email.
7. Confirm email exactly matches challenge email.
8. Verify the secure OTP representation.
9. Increment attempts on failures.
10. Consume challenge on success.
11. Issue a short-lived email-verification grant.

Response:

```json
{
  "verified": true,
  "verification_token": "...",
  "expires_in": 600
}
```

The verification token must NOT simply be:

```text
verified=true
```

It must be a cryptographically secure, opaque token or equivalent server-verifiable grant.

---

# 14. VERIFICATION GRANT

Create a secure mechanism for the successful OTP verification result.

Conceptually:

```text
OTP verified
    ↓
verification grant created
    ↓
grant bound to:
    email
    purpose
    role
    expiration
    challenge
    optional request context
    ↓
frontend receives opaque token
```

The grant should:

```text
expire quickly
be single-use
be bound to email
be bound to purpose
be bound to role for login
not be forgeable
```

When the next protected action occurs, the backend validates the grant.

Do not simply trust a client-side `emailVerified` state.

---

# 15. PREVENT OTP REUSE

After successful verification:

```text
challenge.consumed = true
```

or equivalent.

Trying the same OTP again must fail.

Requesting a new OTP should invalidate/supersede the old challenge.

Example:

```text
OTP A requested
↓
OTP B requested
↓
OTP A must no longer work
↓
Only OTP B is valid
```

This is important because users can otherwise use an older leaked code.

---

# 16. WRONG OTP HANDLING

Wrong OTP:

```text
reject
increment attempts
do not issue verification grant
```

Example response:

```text
Incorrect verification code.
```

Do not reveal whether:

```text
email exists
challenge exists
code was almost correct
```

---

# 17. EXPIRED OTP HANDLING

After expiry:

```text
reject
invalidate challenge
require new OTP
```

Response:

```text
This verification code has expired. Request a new code.
```

---

# 18. RATE LIMITING

Implement rate limiting for:

```text
OTP request
OTP resend
OTP verification
```

Rate limit using a combination of:

```text
IP
email
purpose
role
challenge
```

Prevent:

```text
OTP spam
email bombing
brute force
rapid resend
```

Example policy:

```text
one OTP request per email/purpose every 60 seconds
maximum 5 sends/hour
maximum 5 verification attempts/challenge
```

Keep limits configurable.

If Redis is available, use it for distributed rate limiting.

If Redis is unavailable, use a secure backend-compatible fallback appropriate for the current deployment architecture.

---

# 19. ACCOUNT ENUMERATION CONSIDERATION

For unauthenticated email-OTP request endpoints, avoid exposing whether an email belongs to an account.

For setter/admin/invigilator login, a request can return a generic response:

```text
If this email can be used for this login, a verification code has been sent.
```

Then after OTP verification, the normal account/enrollment validation still happens.

This prevents:

```text
email exists
email doesn't exist
```

from becoming a user-enumeration oracle.

However, the core requirement remains:

```text
no correct OTP
→ no verified email
→ no login
```

---

# 20. INVIGILATOR LOGIN — NEW FLOW

Modify:

```text
public/frontend/components/auth/InvigilatorLoginForm.tsx
```

The current flow begins by checking an email-format regex and immediately doing enrollment lookup.

That must change.

New flow:

```text
STEP 1 — Enter Staff Email

        ↓

STEP 2 — Send Email OTP

        ↓

STEP 3 — Enter Email OTP

        ↓

STEP 4 — Backend verifies OTP

        ↓

STEP 5 — Receive verification grant

        ↓

STEP 6 — Server validates invigilator enrollment

        ↓

STEP 7 — Location & Network

        ↓

STEP 8 — Face

        ↓

STEP 9 — Fingerprint

        ↓

STEP 10 — Existing final OTP/authentication

        ↓

STEP 11 — Dashboard
```

Do NOT allow:

```text
email typed
→ enrollment found
→ location
```

anymore.

It must be:

```text
email typed
→ email OTP
→ email verified
→ enrollment
```

---

# 21. INVIGILATOR FRONTEND UI

Replace the current initial state with something like:

```text
Staff Email

[ user@example.com ]

[ Send Verification Code ]
```

After sending:

```text
Verification code sent to
u***@example.com

[ 6-digit OTP ]

[ Verify Email ]
[ Resend code ]
```

Show:

```text
Code expires in 05:00
```

and resend cooldown.

After successful verification:

```text
✓ Email verified
```

Then proceed automatically to the existing enrollment/geofence process.

Do not display the full email unnecessarily in privacy-sensitive places.

---

# 22. INVIGILATOR BACKEND ENFORCEMENT

The frontend step is not sufficient.

Before starting protected invigilator verification, backend must verify:

```text
verification_token
email
purpose=LOGIN
role=INVIGILATOR
```

The frontend must not be able to skip email OTP by directly calling the next endpoint.

Test this explicitly with a direct HTTP request.

---

# 23. INVIGILATOR + LOCAL STORAGE

Do not allow a localStorage enrollment to bypass email OTP.

Current development fallback:

```text
server lookup
↓
localStorage lookup
```

must remain constrained to explicit mock/dev functionality.

Even in mock mode, structure the flow as:

```text
email OTP simulation
→ verified grant
→ mock enrollment
```

not:

```text
localStorage contains email
→ automatically trusted
```

---

# 24. SETTER LOGIN — NEW FLOW

Modify:

```text
public/frontend/components/auth/SetterLoginForm.tsx
```

Current behavior:

```text
email format
+
password
→ backend
→ phone OTP
```

Change to:

```text
Email
↓
Send Email OTP
↓
Enter Email OTP
↓
Email OTP verified
↓
Password
↓
Existing backend password authentication
↓
Existing phone OTP
↓
JWT
↓
Setter dashboard
```

Do not remove password authentication.

Do not remove phone OTP.

Email OTP is an additional mandatory gate.

---

# 25. SETTER UI

Initial screen:

```text
Official Email

[ user@example.com ]

[ Verify Email ]
```

Second state:

```text
Verification code sent to u***@example.com

[ 6-digit OTP ]

[ Verify Email ]
[ Resend ]
```

After successful email verification:

```text
✓ Email verified
```

Then show:

```text
Password
[ ******** ]

[ Send Login OTP ]
```

Then retain the current phone OTP step:

```text
OTP sent to registered phone

[ 6-digit OTP ]

[ Verify & Login ]
```

Do not confuse:

```text
Email OTP
```

with:

```text
Phone OTP
```

They are separate factors.

---

# 26. SETTER BACKEND ENFORCEMENT

The normal login endpoint must require proof that email verification for this exact login context succeeded.

Do not allow someone to skip the email OTP and directly call:

```text
/auth/login
```

with email + password and obtain a phone OTP.

The intended chain becomes:

```text
email grant
+
email
+
role=SETTER
→ allowed to execute password login
```

Without the grant:

```text
reject
```

---

# 27. ADMIN LOGIN — NEW FLOW

Modify:

```text
public/frontend/components/auth/AdminLoginForm.tsx
```

Use the same structure as setter:

```text
Admin Email
↓
Email OTP
↓
Email verified
↓
Password
↓
Existing phone OTP
↓
JWT
↓
Admin dashboard
```

Do not remove:

```text
password
phone OTP
consent
role validation
```

Email OTP is an additional required gate.

---

# 28. ADMIN BACKEND ENFORCEMENT

The backend must require:

```text
email verification grant
purpose=LOGIN
role=ADMIN
email matches login identifier
```

before issuing the existing phone OTP challenge.

Therefore:

```text
admin@example.com
↓
no email OTP
↓
correct password
```

must still fail.

This must be tested via direct API calls, not just browser testing.

---

# 29. CONTACT FORM — NEW FLOW

Modify:

```text
public/frontend/app/contact/page.tsx
```

Current behavior directly submits:

```text
email
first name
last name
organisation
role
scale
message
```

to:

```text
POST /api/v1/contact/
```

That must change.

New flow:

```text
User enters email
        ↓
Send Email OTP
        ↓
User enters OTP
        ↓
Backend verifies OTP
        ↓
Email verification grant
        ↓
User completes/submits contact form
        ↓
Backend validates verification grant
        ↓
Only then process contact submission
```

---

# 30. CONTACT FRONTEND UX

Add an email verification state.

Example:

```text
Work Email

[ user@example.com ]

[ Send Verification Code ]
```

Then:

```text
Verification code sent to
u***@example.com

[ 6-digit OTP ]

[ Verify Email ]
[ Resend ]
```

After verification:

```text
✓ Email verified
```

Then enable:

```text
Send enquiry
```

Before verification:

```text
Send enquiry
```

must be disabled or the backend must reject the submission.

Prefer both:

```text
frontend prevents submission
+
backend enforces verification
```

---

# 31. CONTACT BACKEND ENFORCEMENT

Modify:

```text
public/backend/app/api/v1/contact.py
```

The contact submission endpoint must require a valid email verification grant.

Request should conceptually include:

```json
{
  "firstName": "...",
  "lastName": "...",
  "email": "user@example.com",
  "organisation": "...",
  "role": "...",
  "scale": "...",
  "message": "...",
  "email_verification_token": "..."
}
```

Backend must verify:

```text
token valid
token not expired
token not consumed
purpose=CONTACT
email matches token email
email matches payload email
```

Only then send/store the contact enquiry.

If token is absent or invalid:

```text
reject with 401/403/400
```

Do not process the message.

---

# 32. CONTACT EMAIL CHANGE

Important UX case:

User verifies:

```text
abc@example.com
```

then changes the field to:

```text
xyz@example.com
```

The previous verification must immediately become invalid.

The contact submit endpoint must reject because:

```text
verified email != submitted email
```

Frontend should also reset:

```text
emailVerified = false
verificationToken = null
```

when the email changes.

The same rule applies to all login pages.

---

# 33. OTP CHANGE / RESEND

When the user clicks:

```text
Resend code
```

the backend must:

```text
invalidate old challenge
generate new challenge
send new OTP
return new challenge ID
```

The old OTP must stop working.

Do not support multiple simultaneously valid OTPs for the same context unless there is a deliberate reason.

---

# 34. SECURITY TOKEN STORAGE

Do not place security-sensitive OTPs in localStorage.

Do not store:

```text
OTP
OTP hash
SMTP password
email verification secret
```

in frontend storage.

For the short-lived verification token, prefer:

```text
in-memory React state
```

or another secure transient mechanism appropriate to the application's architecture.

It must not be persisted longer than necessary.

---

# 35. DO NOT SEND OTP TO A DIFFERENT EMAIL

The OTP must be sent to the exact email entered after normalization.

Example:

User enters:

```text
someone@example.com
```

The email service must target:

```text
someone@example.com
```

not:

```text
admin@example.com
```

and not a predefined internal address.

Do not ever "verify" the user's email by sending a code to a fixed application/admin mailbox.

---

# 36. EMAIL CONTENT

Create a dedicated email template.

Subject:

```text
Your CryptoExam Core verification code
```

Body should clearly say:

```text
Your CryptoExam Core verification code is:

123456

This code expires in 5 minutes.

If you did not request this code, ignore this email.
```

Do not include:

```text
password
JWT
session token
full internal account data
biometric information
```

The OTP email should reveal only what is needed.

---

# 37. EMAIL DELIVERY FAILURE

Security-critical behavior must fail closed.

If SMTP/provider returns an error:

```text
Do NOT say "OTP sent"
Do NOT create a usable verification grant
Do NOT expose OTP
```

Return a generic server-side delivery error such as:

```text
We could not send the verification code right now. Please try again.
```

Log the provider error securely on the backend.

Do not log:

```text
OTP
full email body
SMTP password
verification token
```

---

# 38. RENDER PRODUCTION PIPELINE

Because the live application is hosted on Render, implement the deployment side as part of this task.

After code changes:

## Backend Render environment

Set:

```text
DEBUG=false

SMTP_HOST=<production SMTP host>
SMTP_PORT=587
SMTP_USER=<SMTP username>
SMTP_PASS=<SMTP password>
SMTP_FROM=<verified sender>

EMAIL_OTP_SECRET=<strong random secret>

EMAIL_OTP_TTL_SECONDS=300
EMAIL_OTP_MAX_ATTEMPTS=5
EMAIL_OTP_RESEND_COOLDOWN_SECONDS=60
EMAIL_OTP_MAX_SENDS_PER_HOUR=5

EMAIL_OTP_DEV_MODE=false
```

Do not hard-code values into source files.

Do not commit `.env` secrets.

---

# 39. FRONTEND RENDER CONFIGURATION

Confirm production:

```text
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_USE_MOCK
```

are correct.

Production must use:

```text
NEXT_PUBLIC_USE_MOCK=false
```

where applicable.

The frontend must communicate with the deployed real FastAPI backend.

Do not leave OTP verification routed to a mock implementation in production.

---

# 40. DATABASE MIGRATION

Inspect the existing database creation/migration strategy.

Add the email OTP challenge table using that mechanism.

Do NOT depend on:

```text
Base.metadata.create_all()
```

alone if production uses a persistent existing database and schema migration is required.

The migration must safely create the new table without destroying existing:

```text
users
otp_challenges
enrollments
staff_registration_requests
```

or any other data.

---

# 41. BACKEND API CLIENT

Extend:

```text
public/frontend/lib/api/client.ts
```

with methods similar to:

```ts
requestEmailOtp(...)
verifyEmailOtp(...)
```

For example conceptually:

```ts
requestEmailOtp(data)
verifyEmailOtp(data)
```

Keep all HTTP behavior in the centralized API client.

Do not scatter raw `fetch()` calls throughout every login component unless that is the repository's established architecture.

---

# 42. FRONTEND STATE MACHINE

Do not manage the new flow with many unrelated booleans such as:

```text
showOtp
verified
loading
emailSent
canContinue
```

that can become contradictory.

Prefer an explicit state machine/status:

```text
EMAIL_ENTRY
EMAIL_OTP_SENDING
EMAIL_OTP_SENT
EMAIL_VERIFYING
EMAIL_VERIFIED
NEXT_AUTH_FACTOR
ERROR
```

For each page, keep the state transitions deterministic.

---

# 43. PREVENT BYPASS THROUGH URL / REFRESH

A user must not be able to:

```text
enter email
refresh page
manually manipulate state
call next-step API
```

and bypass email verification.

If the page refreshes before login verification finishes:

```text
email OTP flow resets
```

or the short-lived challenge can safely be recovered using a server-issued identifier.

Never recover a state such as:

```text
emailVerified=true
```

from localStorage.

---

# 44. ROLE / PURPOSE TEST MATRIX

Verify the backend rejects cross-context misuse.

Examples:

```text
ADMIN email grant + SETTER login
→ reject

SETTER email grant + ADMIN login
→ reject

CONTACT email grant + ADMIN login
→ reject

INVIGILATOR email grant + CONTACT submission
→ reject

Different email + same grant
→ reject

Correct email + expired grant
→ reject

Correct email + reused grant
→ reject
```

This is mandatory.

---

# 45. TEST FAKE EMAIL SCENARIOS

Explicitly test:

### Case 1 — Invalid format

```text
abc
```

Expected:

```text
Rejected immediately.
No OTP sent.
```

### Case 2 — Random email-looking address

```text
random123456@example.com
```

Expected:

```text
Format may pass.
OTP sent only if delivery succeeds.
Without access to that mailbox, verification cannot complete.
```

The critical point is:

```text
format pass ≠ email verification
```

### Case 3 — Correct email, wrong OTP

Expected:

```text
Rejected.
No verification grant.
```

### Case 4 — Correct email, correct OTP

Expected:

```text
Verified.
Grant issued.
Continue.
```

### Case 5 — Expired OTP

Expected:

```text
Rejected.
Request new code.
```

### Case 6 — Reused OTP

Expected:

```text
Rejected.
```

### Case 7 — Changed email after verification

Expected:

```text
Verification invalidated.
New OTP required.
```

### Case 8 — Email changed back

Do not automatically trust the old verification.

Require a fresh valid grant or the still-valid grant if your server-side policy safely supports it.

Preferred:

```text
new email field value
→ require fresh verification
```

---

# 46. API BYPASS TESTS

Do not rely solely on UI testing.

Directly call:

```text
POST /auth/login
POST /contact/
```

without a valid email verification grant.

Expected:

```text
reject
```

Then call with:

```text
correct email
correct verification grant
```

Expected:

```text
continue to next authentication/submission stage
```

This proves the security control exists in the backend rather than only in React.

---

# 47. SETTER/ADMIN PHONE OTP REGRESSION TEST

After adding email OTP verify that:

```text
Email OTP
↓
Password
↓
Phone OTP
↓
JWT
```

still works.

Test:

```text
correct email OTP
correct password
correct phone OTP
→ login success
```

and:

```text
correct email OTP
wrong password
→ fail
```

and:

```text
correct email OTP
correct password
wrong phone OTP
→ fail
```

No authentication factor should be removed.

---

# 48. INVIGILATOR REGRESSION TEST

Verify:

```text
Email OTP
↓
Enrollment lookup
↓
Location
↓
Face
↓
Fingerprint
↓
Existing final OTP
↓
Dashboard
```

Test:

```text
wrong email OTP
→ stop

correct email OTP + unknown email
→ stop

correct email OTP + known enrollment + outside centre
→ stop at location

correct email OTP + valid location + wrong face
→ stop

correct email OTP + valid location + face + wrong fingerprint
→ stop

correct email OTP + all factors
→ success
```

---

# 49. CONTACT REGRESSION TEST

Test:

```text
email OTP not verified
→ contact submit rejected

email OTP verified
→ submit accepted

email verified for abc@example.com
→ change field to xyz@example.com
→ submit rejected

email verified
→ team email sent
→ acknowledgement sent if delivery succeeds
```

The contact endpoint must never process the form merely because Pydantic/HTML considers the email syntactically valid.

---

# 50. CONTACT BACKEND EMAIL TYPE

Improve:

```python
email: str
```

to use the repository's appropriate email validator, such as:

```python
EmailStr
```

or an equivalent validation method.

However:

```text
EmailStr
```

is only a syntax check.

Do NOT consider that the verification mechanism.

The actual requirement remains OTP proof.

---

# 51. LOGGING / PRIVACY

Do not log:

```text
full OTP
password
SMTP credentials
verification token
full email body
```

Mask emails where appropriate:

```text
m***@example.com
```

Log only operational information:

```text
OTP requested
OTP delivery succeeded/failed
challenge expired
verification succeeded
verification failed
```

with safe identifiers.

---

# 52. AUDIT EVENTS

Where the repository's audit architecture permits it, record security-relevant events:

```text
EMAIL_OTP_REQUESTED
EMAIL_OTP_DELIVERY_FAILED
EMAIL_OTP_VERIFIED
EMAIL_OTP_FAILED
EMAIL_OTP_EXPIRED
EMAIL_OTP_RATE_LIMITED
```

Do not store the actual OTP.

The audit event may include:

```text
purpose
role
timestamp
masked email
IP
success/failure
reason
```

---

# 53. UI ERROR MESSAGES

Use clear but safe messages.

For request:

```text
Verification code sent to your email address.
```

For invalid:

```text
Incorrect verification code.
```

For expired:

```text
This code has expired. Request a new one.
```

For delivery failure:

```text
We could not send the verification code. Please try again.
```

For rate limiting:

```text
Too many verification attempts. Please wait and try again.
```

Do not tell unauthenticated users:

```text
This email is registered.
This email isn't registered.
This account belongs to Admin.
```

---

# 54. ACCESSIBILITY

The OTP UI must support:

```text
keyboard navigation
screen readers
mobile keyboards
paste
autofill where appropriate
```

Use:

```html
inputMode="numeric"
autocomplete="one-time-code"
```

for OTP fields where appropriate.

Do not globally disable paste.

Do not add anti-cheat input restrictions to these authentication OTP fields.

---

# 55. RESEND UX

When user clicks resend:

```text
disable resend for cooldown
show timer
request new code
invalidate previous code
```

Example:

```text
Resend available in 42s
```

After resend:

```text
Previous code is no longer valid.
```

---

# 56. EMAIL DELIVERY PIPELINE VALIDATION

After deployment to Render, perform a real end-to-end test with a real mailbox.

For each of:

```text
invigilator
setter
admin
contact
```

use a real email address that you control.

Confirm:

```text
request OTP
→ email arrives
→ enter correct OTP
→ backend accepts
```

Then test:

```text
wrong OTP
→ reject
```

Then:

```text
wait for expiry
→ reject
```

Then:

```text
resend
→ old OTP rejected
→ new OTP accepted
```

---

# 57. DO NOT CONSIDER THE FEATURE COMPLETE IF SMTP IS NOT CONFIGURED

This is important.

A deployment in which:

```text
SMTP missing
→ dev OTP displayed
```

does NOT satisfy this task.

The production acceptance requirement is:

```text
real email delivery
+
real OTP verification
```

If Render cannot send real OTP emails, Claude Code must report that as an unresolved deployment blocker rather than claiming the feature is complete.

---

# 58. AUTOMATED TESTS

Add backend tests for:

```text
email normalization
email syntax validation
OTP generation
OTP hashing/HMAC
OTP expiration
OTP attempt limits
OTP resend invalidation
OTP verification
verification grant creation
grant expiration
grant consumption
purpose binding
role binding
email mismatch rejection
rate limiting
SMTP failure
missing SMTP configuration
production dev-mode protection
```

Add frontend tests for:

```text
email entry
send OTP
OTP input
verify OTP
wrong OTP
expired OTP
resend
email change
disabled continue before verification
successful transition to next factor
```

---

# 59. SECURITY TESTS FOR DIRECT API ABUSE

Attempt:

```text
POST /contact/
```

without token.

Expected:

```text 401/403
```

Attempt:

```text
POST /contact/
```

with token bound to a different email.

Expected:

```text 401/403
```

Attempt:

```text
POST /contact/
```

with token bound to LOGIN rather than CONTACT.

Expected:

```text 401/403
```

Attempt:

```text
POST /auth/login
```

for ADMIN with correct password but without email grant.

Expected:

```text rejected
```

Attempt:

```text
POST /auth/login
```

for SETTER with correct password but wrong-role email grant.

Expected:

```text rejected
```

---

# 60. DO NOT BREAK EXISTING AUTHENTICATION

After implementation verify:

```text
Candidate login/enrolment
Setter login
Admin login
Invigilator login
Centre admin registration/login
Existing phone OTP
Existing WebAuthn
Existing face verification
Existing geolocation verification
Contact submission
```

No existing authentication factor may be silently removed.

---

# 61. IMPORTANT DIFFERENCE BETWEEN EMAIL OTP AND "FAKE EMAIL DETECTION"

Do not implement or document this as:

```text
fake email detector
```

The actual security property is:

```text
email ownership/access verification
```

The system does not need a magical algorithm that predicts whether every mailbox exists.

It must prove:

```text
the person attempting this action can receive mail at the exact entered address
```

by requiring the correct OTP from that mailbox.

---

# 62. FINAL CODE AUDIT

Search the repository again for:

```text
emailVerified = true
isEmailValid
emailRegex
dev_code
dev_preview
SMTP-FAILED
EMAIL_OTP
verifyEmail
requestEmailOtp
```

Check that there is no alternate path that permits:

```text
email format valid
→ authentication
```

without:

```text
email OTP verified
```

For these four flows:

```text
/login?role=invigilator
/login?role=setter
/login?role=admin
/contact
```

there must be no successful path around email OTP verification.

---

# 63. BUILD / TEST / DEPLOY

After implementation run:

### Frontend

From:

```text
public/frontend
```

run the available:

```bash
npm run lint
npm run build
npm run typecheck
```

if those scripts exist.

### Backend

From:

```text
public/backend
```

run:

```bash
pytest
```

or the repository's actual configured test command.

Run database migration tests.

Run endpoint integration tests.

---

# 64. PRODUCTION RENDER TEST

After deployment:

1. Open invigilator login.
2. Enter a real email.
3. Click Send Verification Code.
4. Confirm real email receipt.
5. Enter correct OTP.
6. Confirm it proceeds to enrollment/location.

Repeat for setter and admin.

Then test contact:

1. Enter real email.
2. Request OTP.
3. Confirm real email receipt.
4. Enter correct OTP.
5. Submit enquiry.
6. Confirm backend accepts the submission.

Test a fake/random email-looking address.

Expected:

```text
No mailbox access
→ no valid OTP
→ verification cannot complete
→ protected action cannot proceed
```

---

# 65. REQUIRED FINAL REPORT

Claude Code must finish by reporting:

## A. Root cause

Explain exactly why the old system accepted arbitrary email-looking strings.

## B. Files changed

List every file changed.

## C. Database changes

List new/changed tables and fields.

## D. API changes

List every new or modified endpoint.

For example:

```text
POST /api/v1/email-verification/request
POST /api/v1/email-verification/verify
POST /api/v1/auth/login
POST /api/v1/contact/
```

with a one-line description.

## E. Frontend flow changes

Explain the new UI flow for:

```text
Invigilator
Setter
Admin
Contact
```

## F. Email pipeline

Explain:

```text
SMTP provider
Render environment variables
OTP generation
OTP storage
OTP expiration
OTP verification
rate limiting
production failure handling
```

## G. Security validation

Demonstrate that direct API bypass attempts fail.

## H. Tests

List exact test commands and results.

## I. Deployment status

Explicitly state:

```text
Real SMTP configured: YES/NO
Production DEBUG=false: YES/NO
Email OTP dev bypass disabled: YES/NO
Real mailbox OTP tested: YES/NO
```

Do not mark the task complete if any security-critical item is `NO`.

---

# DEFINITION OF DONE

The implementation is complete only when every statement below is true:

- [ ] Invigilator login requires a real email OTP before continuing.
- [ ] Setter login requires a real email OTP before password authentication can continue.
- [ ] Admin login requires a real email OTP before password authentication can continue.
- [ ] Contact submission requires a real email OTP before submission.
- [ ] OTP is sent to the exact entered email address.
- [ ] Correct OTP is required.
- [ ] Wrong OTP is rejected.
- [ ] Expired OTP is rejected.
- [ ] Reused OTP is rejected.
- [ ] Resending invalidates the previous OTP.
- [ ] OTP attempts are rate limited.
- [ ] OTP sending is rate limited.
- [ ] Verification grants are short-lived.
- [ ] Verification grants are bound to email.
- [ ] Verification grants are bound to purpose.
- [ ] Login grants are bound to role.
- [ ] Contact grants cannot be reused for login.
- [ ] Login grants cannot be reused for contact.
- [ ] Changing the email invalidates the previous verification.
- [ ] Frontend cannot fake `emailVerified=true`.
- [ ] Backend rejects protected actions without a valid verification grant.
- [ ] Backend rejects grants for a different email.
- [ ] Backend rejects grants for a different role/purpose.
- [ ] OTP is never exposed in production API responses.
- [ ] OTP is never stored in plaintext.
- [ ] OTP is never logged.
- [ ] SMTP failure does not expose OTP or dev preview.
- [ ] Missing SMTP configuration fails closed in production.
- [ ] `DEBUG=false` is configured in production.
- [ ] `EMAIL_OTP_DEV_MODE=false` is configured in production.
- [ ] Real SMTP credentials exist only on the backend.
- [ ] A real mailbox has been tested end-to-end.
- [ ] Setter/admin existing phone OTP remains functional.
- [ ] Invigilator existing biometric/location checks remain functional.
- [ ] Contact acknowledgement still works after email verification.
- [ ] Existing authentication flows are not bypassed or weakened.
- [ ] Automated tests pass.
- [ ] Production deployment has been manually verified.

# FINAL SECURITY PRINCIPLE

The system must enforce this invariant:

```text
A syntactically valid email address
        ≠
A verified email address

A verified email address means:

OTP generated by backend
        ↓
OTP delivered to exact email
        ↓
User submits matching OTP
        ↓
Backend verifies
        ↓
Short-lived server-side verification grant
        ↓
Only then allow protected action
```

There must be no alternate successful path around this sequence for:

```text
Invigilator Login
Setter Login
Admin Login
Contact Submission
```