# CryptoExam Core — Fix Plan (Claude Code prompt)

Repo: `github.com/sayan69-source/crypto_exam`
Stack: Next.js 16 frontend (`public/frontend`) + FastAPI/SQLite backend (`public/backend`) + separate private portals (`private/centre-admin`, `private/system-admin`).

This document is written so you can paste it directly to **Claude Code** as the working brief. It is based on an actual read-through of the repo (files/line numbers below), not guesses — but Claude Code should re-verify each "Current state" note against the live code before editing, since the repo may have moved on since this was written.

---

## 0. Ground rules for Claude Code

1. Work backend-first, then frontend, for each problem — the UI changes depend on new/changed API fields.
2. Every DB schema change needs an Alembic-style migration or an update to `app/services/seeder.py` (SQLite auto-creates + seeds on first boot — check how migrations are currently handled before adding a raw `ALTER TABLE`).
3. Don't touch the `private/` portals unless a problem explicitly requires it (Problems 2 and 5 do).
4. Preserve the existing "no mock data in admin screens" convention (`lib/api/admin.ts` comment: real backend or honest error, never silent fallback).
5. After each problem, run/build the frontend (`npm run build` in `public/frontend`) and start the backend to sanity check no regressions.
6. Confirm file paths below still match `main` — the repo is under active development (65+ commits) and paths may have shifted.

---

## Problem 0.5 — Shared email service (prerequisite for Problems 1 & 2)

**Why this is its own step**: Problem 1's fix and Problem 2's fix each pointed at the other for "the real email-sending service" (Problem 1 said "see Problem 2"; Problem 2 said "the service built for Problem 1") — as originally written, neither task actually owned building it. Verified: there is currently **no email infrastructure anywhere in the backend** (no SMTP client, no SendGrid/Mailgun/nodemailer, nothing) — `grep`ing the whole `public/backend` and `public/frontend` trees for `smtp|sendgrid|send_email|EmailService|nodemailer` returns zero hits. Build it once, here, before either consumer needs it.

**Fix**
1. Add `app/services/email.py` — a small `EmailService` with a single `send(to, subject, body)` method. Mirror the existing OTP dev-mode pattern (`services/auth.py` / wherever SMS OTP dev-mode lives): if `SMTP_HOST` / an email provider key isn't configured, don't fail — return the composed message in the API response and have the calling page show it, clearly flagged as dev-mode, the same way the SMS OTP flow does today.
2. If a real provider is configured (env vars, e.g. `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` or a provider API key), send for real.
3. Keep this service dependency-injected (`Depends(get_email_service)` or a simple module-level singleton) so both the candidate-enrolment confirmation (Problem 1) and the contact form (Problem 2) call the same code path.

**Acceptance criteria**
- One shared, testable email-sending code path exists.
- Both the candidate-enrolment confirmation and the contact form use it — no duplicate/parallel email logic.

---

## Problem 1 — Fake email / face-detection is not real identity verification

**Current state**
- `public/frontend/app/candidate-enrolment/page.tsx` — candidate enrolment collects **name, DOB, exam, centre, and a real 128-d face descriptor** (`lib/biometric/face-real.ts`, face-api.js on-device). There is **no email field anywhere in candidate enrolment** — no email is collected, so there's nothing to verify.
- `public/backend/app/api/v1/staff_reg.py` — centre staff registration stores only a SHA-256 hash of a face frame (`face_embedding_hash`), not a real face descriptor/embedding — this is a raw image hash, not a biometric match, so two different photos of the same face never match and there's no actual "is this a real registered face" check.
- `public/frontend/components/auth/InvigilatorLoginForm.tsx` — invigilator login keys a WebAuthn credential lookup off a **typed email string stored client-side** ("No enrollment found for this email on this device"), so "email identity" here is just a local-browser lookup key, not a server-verified identity.
- Login flows (`app/(auth)/login/page.tsx`, `AdminLoginForm.tsx`, `SetterLoginForm.tsx`) collect email + password + SMS OTP — this part is real. The "fake" pieces are (a) staff face capture being a raw hash instead of a comparable embedding, and (b) invigilator identity being resolved client-side by a typed email with no server record.

**Fix**
1. **Candidate enrolment**: add a real email field (`email: str`) to the `Enrollment` model and `/api/v1/enroll/candidate` request, used for the enrolment confirmation notice — and actually send a confirmation via the shared `EmailService` built in Problem 0.5, below. Enforce a verified-format email + (optional) email OTP confirmation step before the enrolment is marked complete, mirroring the SMS OTP pattern already used for portal logins.
2. **Centre staff registration face capture**: replace the SHA-256 frame hash in `staff-registration/page.tsx` with the same real face-api.js descriptor pipeline used in candidate enrolment (`lib/biometric/face-real.ts`), and change `StaffRegistrationRequest.face_embedding_hash` (or add a new column) to store the 128-d descriptor so it can later be compared, the same way `/api/v1/enroll/verify-face` compares candidate descriptors. Update `staff_reg.py`'s `_HEX64` validation accordingly (it currently only accepts a 64-char hex hash).
3. **Invigilator login**: replace the client-side "email → WebAuthn credential on this device" resolution with a server-side lookup: the backend should hold the invigilator's registered email/identity (from the approved `StaffRegistrationRequest`) and issue/verify the WebAuthn challenge against that server record, not a local-storage guess.

**Acceptance criteria**
- Candidate enrolment requires and stores a real email; an actual message is dispatched (or a dev-mode equivalent, matching the existing OTP dev-mode pattern where the code is "returned in the API response and the login UI shows it — clearly flagged").
- Centre-staff face capture produces a comparable descriptor, not a raw-image hash.
- Invigilator login can't succeed for an email with no server-side registered/approved record, even on a browser that has some other unrelated WebAuthn credential.

---

## Problem 2 — No approval action in the admin portal; only a non-functional "send" form

**Current state**
- `public/backend/app/api/v1/admin.py` exposes `GET /admin/candidates` (roster, read-only) but **no** `POST /admin/candidates/{id}/approve` or `/reject` — there is no candidate-approval endpoint at all.
- `public/frontend/app/admin/candidates/page.tsx` (60 lines) is a pure read-only table — no action buttons, no approve/reject/flag control, despite an `EnrollmentStatus` enum existing in `app/models/__init__.py` that implies a status workflow.
- Centre-Admin approvals (`public/frontend/app/admin/centre-admin-approvals/page.tsx`) and the private centre-admin portal (`private/centre-admin/app/approvals/page.tsx`) **do already have working "Approve & issue one-time code" buttons** — that part is fine and should not be duplicated or broken.
- `public/frontend/app/contact/page.tsx` — the site-wide "Add exam" contact form (`handleSubmit`) only does `e.preventDefault(); setSent(true)` — it never calls an API or sends anything. This is very likely the "useless send mail button": it looks like a submission action but performs no real work. It is on the public marketing site, not literally inside `/admin/*`, but functionally it's the only "we'll get back to you" control in the whole app and reads as the admin-facing "approval request" surface.

**Important correction — do not reuse `EnrollmentStatus` for this.** Verified in `app/models/__init__.py`: `EnrollmentStatus` is `ENROLLED / PRESENT / ABSENT / DISQUALIFIED` — that's exam-*day* attendance/proctoring state, not an admin-approval workflow, and there is no `PENDING`/`APPROVED`/`REJECTED` value in it. Worse, `DISQUALIFIED` already has a specific meaning ("flagged during the exam session") that a rejected *application* must not collide with. The codebase already has the right template sitting next to it: `StaffRegistrationRequest` / `StaffApprovalStatus` (`PENDING/APPROVED/REJECTED` + `approver_role` + `created_at` + `approved_at`). Mirror that pattern instead of touching `EnrollmentStatus`.

**Fix**
1. **Add a real approval field to `Enrollment`**: new `approval_status` column (`Enum: PENDING/APPROVED/REJECTED`, mirroring `StaffApprovalStatus`), plus `approved_by` (user id) and `approved_at`/`rejected_at` timestamps and a `rejection_reason` text field. Leave `EnrollmentStatus` untouched — it keeps meaning exam-day state.
2. **Add real candidate approval to the backend**: in `admin.py`, add
   - `POST /admin/candidates/{id}/approve` → set `approval_status = APPROVED`, stamp `approved_by`/`approved_at`, write an `AdminAuditLog` row (the pattern already used by `emergency_pause`/`emergency_abort`).
   - `POST /admin/candidates/{id}/reject` (with a required `rejection_reason`, same audit pattern) and/or `flag` for suspected duplicate-face/fraud cases.
3. **Add `AdminCandidate` action methods** to `public/frontend/lib/api/admin.ts` calling the new endpoints.
4. **Rebuild `admin/candidates/page.tsx`** to show an "Approve" / "Reject" button per row (disabled once already approved/rejected, matching the busy/disabled pattern in `centre-admin-approvals/page.tsx`), and a status badge reflecting the new `approval_status` — kept visually distinct from the existing `EnrollmentStatus` badge so the two don't get read as the same thing.
5. **Fix or remove the fake contact form**: either
   - wire `contact/page.tsx` to a real backend endpoint (`POST /api/v1/contact` → stores a lead + sends a real email via the shared `EmailService` built in Problem 0.5, below), or
   - if it's intentionally a marketing-only stub, relabel it so it doesn't imply an action was taken (currently it flips to a "sent" confirmation state with nothing behind it, which is the "useless" complaint).

**Acceptance criteria**
- Admin can approve/reject a candidate from `/admin/candidates` and the action is persisted + audited, using a status field dedicated to approval — not a repurposed exam-day status.
- The contact/"send mail" form either genuinely delivers a message or is clearly labeled as informational, not implying an action succeeded when it didn't.

---

## Problem 3 — No "registration year" for candidates

**Current state**
- `Exam` model (`app/models/__init__.py`, line ~159) and `Enrollment` model (line ~316) have **no year field at all** — no `academic_year`, no `exam_year`, nothing. The README's exam catalogue mixes multiple years implicitly (NEET UG 2026 mock exam in `seeder.py`) but nothing is structured by year.
- `candidate-enrolment/page.tsx` only asks for name, DOB, exam, centre, face — no year selection.

**Fix**
1. Add a `year: int` (or `academic_year: str`) column to `Exam` (so each exam instance is tied to a cycle, e.g. "NEET UG 2026" vs "NEET UG 2027") and update the seeder to populate it.
2. Add `registration_year` to `Enrollment`, defaulted from the selected exam's year but shown to the candidate for confirmation (some exams allow multi-year eligibility windows).
3. **Also add `enrolled_at: DateTime` to `Enrollment`.** Verified: the `Enrollment` model currently has *no timestamp column at all* — not even a bare `created_at` — so there's no way to know when an enrollment happened, independent of year. Default it server-side (`datetime.utcnow`) on insert; derive the displayed registration year from `enrolled_at` where possible rather than only trusting a client-selected value, and treat `registration_year` as the confirmed/authoritative field while `enrolled_at` is the audit timestamp. This also guards against drift if a candidate enrolls late in a multi-year eligibility window and `Exam.year` and their actual enrollment year disagree.
4. Update `GET /api/v1/enroll/exams` response and `EnrolExam` type (`lib/api/enroll.ts`) to include `year`.
5. Update `candidate-enrolment/page.tsx`: show the year alongside/within the exam dropdown (e.g. "NEET UG 2026") and store it on submit.
6. Update `admin/candidates/page.tsx` table to show the registration year column.

**Acceptance criteria**
- Every enrolled candidate record has an explicit, queryable registration year *and* an audit timestamp (`enrolled_at`).
- Admin roster and candidate enrolment both surface it.

---

## Problem 4 — `/administration` page

**Current state**
- `public/frontend/app/administration/page.tsx` (21 lines) is a thin marketing/explainer wrapper around a shared `RoleHub` component — it's an "about this role" landing page, not the actual admin console (`/admin/*`). Check `components/marketing/RoleHub.tsx` for its links/CTAs.
- There is **no link to it anywhere in navigation** (see Problem 6) — it's only reachable by typing the URL directly or via the command palette, so in practice it reads as broken/orphaned even though the code itself renders.

**Fix**
1. Confirm `RoleHub`'s CTA correctly deep-links to `/admin/login` (the real portal), not a dead end.
2. Add `/administration` to primary navigation (see Problem 6) alongside the equivalent `/for-setters`, `/for-administrators` hub pages, so admins can actually discover it instead of it being an orphaned route.
3. Decide product-wise whether `/administration` and `/for-administrators` are meant to be the same page (there appear to be two similarly-named marketing routes — `app/administration` and `app/for-administrators`); if redundant, consolidate to one canonical URL and redirect the other.

**Acceptance criteria**
- `/administration` is reachable from the site nav, and its primary CTA lands on a real, working login/portal, not a placeholder.

---

## Problem 5 — Centre staff registration: no "which exam" option, and centre list doesn't show

**Current state**
- `public/frontend/app/staff-registration/page.tsx` collects role, **centre**, name, face — there is **no exam selector at all**.
- `StaffRegistrationRequest` model and `staff_reg.py` (`public/backend/app/api/v1/staff_reg.py`) have **no `exam_id` field** — centre staff (Centre Admins / Invigilators) are registered generically, not tied to a specific examination they'll be staffing. This matches the reported gap directly: there's no field to say which exam a staff member is registering to support.
- The centre dropdown *is* wired in code (`staffApi.centres()` → `GET /api/v1/staff/centres` → `SELECT * FROM Center`), so structurally it should populate. If it's empty in practice, the likely causes are:
  - the `Center` table is empty/unseeded in the running DB (check `app/services/seeder.py` for whether centres are actually seeded on fresh boot),
  - or the frontend's `NEXT_PUBLIC_API_URL` doesn't point at the backend (`relayDown` state triggers silently → the dropdown shows "loading centres…" or the red relay-unavailable message instead of the list), which reads to a user as "no centre list."

**Fix**
1. **Backend**: add `exam_id: str | None` (nullable if some staff roles are exam-agnostic, e.g. a Centre Admin overseeing the venue generally vs an Invigilator assigned to a specific exam sitting) to `StaffRegistrationRequest`, plus a `GET /api/v1/staff/exams` endpoint (mirroring `enroll/exams`) so the form can list exams.
2. **Frontend**: add an "Examination" `<select>` to `staff-registration/page.tsx` right above/below the centre select, sourced from the new `/staff/exams` endpoint, required before submit (same disabled-button pattern as the existing required fields).
3. **Diagnose the empty centre list**: verify `seeder.py` actually inserts `Center` rows on a clean SQLite boot, and confirm `staffApi.centres()` is hitting a live backend in the environment being tested (check `.env.local` / `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_USE_MOCK`). If centres exist in the DB but the UI still shows nothing, check for a response-shape mismatch between `staff_reg.py`'s `{"centres": [...]}` and what `staffApi.centres()` expects (`json.centres ?? []`) — these currently match, so the more likely bug is an empty/unseeded table or a misconfigured API URL in the deployed environment; confirm which it is before changing code.
4. Update the admin's staff-approval views (`admin/centre-admin-approvals/page.tsx`, `private/centre-admin/app/approvals/page.tsx`) to also display which exam the applicant registered for, once the field exists.

**Acceptance criteria**
- Staff registration requires selecting an exam, and that selection is stored and later visible to the approver.
- The centre dropdown reliably lists real centres in a normally-seeded environment; if it was an environment/config issue, document the fix (e.g. `.env.local` correction) rather than papering over it in code.

---

## Problem 6 — Navigation

**Current state**
- `public/frontend/components/marketing/SiteHeader.tsx` — the entire global nav is exactly two links: **Home** and **Login**, plus a search/command-palette trigger and an "Add exam" CTA (routes to `/contact`). Every other route in the app — `candidate-enrolment`, `staff-registration`, `administration`, `for-administrators`, `for-setters`, `platform`, `candidates`, `centers`, `invigilators`, `about`, `explore` — is only reachable by direct URL or via `Cmd/Ctrl+K` command palette (`CommandPalette.tsx`). That's ~24 top-level routes with effectively one discoverable navigation entry.
- The signed-in portal layouts (`AdminLayout.tsx`, `SetterLayout.tsx`, `InvigilatorLayout.tsx`, `CandidateLayout.tsx`) each have their own reasonable internal sidebar nav once you're inside a portal — the gap is entirely on the **public marketing site** getting people into the right portal/registration flow in the first place.

**Fix**
1. Expand `SiteHeader`'s `LINKS` (or add a proper dropdown/menu) to surface at minimum:
   - Candidate: `Candidate Enrolment` (`/candidate-enrolment`)
   - Staff: `Centre Staff Registration` (`/staff-registration`)
   - Portals: links (or a "Portals" dropdown) to `/login`, `/admin/login`, `/setter/login`, `/invigilator/login`
   - Info: `Platform` (`/platform`), `About` (`/about`), `Administration`/`For Administrators`, `For Setters`
2. Keep the command palette as a power-user shortcut, not the only path — it currently functions as the de facto primary nav, which isn't discoverable for a first-time visitor.
3. Verify all internal `<Link>`s across these pages actually resolve (a quick pass: `grep -rn 'href="/' public/frontend/app` and confirm each target route exists) — flag and fix any dead links found, since Problem 4 already surfaced one orphaned route (`/administration`).
4. Check mobile: `SiteHeader` has no visible hamburger/mobile-menu handling in the reviewed code — confirm there's a responsive nav pattern once more links are added, or add one.

**Acceptance criteria**
- A first-time visitor can reach candidate enrolment, staff registration, and every portal login from the header without knowing the command palette shortcut exists.
- No dead links in primary navigation.

---

## Suggested execution order for Claude Code

1. Problem 3 (registration year + `enrolled_at` timestamp) — smallest, unblocks nothing else, good warm-up/schema-migration dry run.
2. Problem 5 (exam field + centre list diagnosis) — backend model + seeder work, same shape as Problem 3.
3. **Problem 0.5 (shared `EmailService`)** — no dependency on anything above; build it now so Problems 1 and 2 don't block on each other.
4. Problem 1 (real email + real face descriptors for staff) — consumes the Problem 0.5 service; touches the same enrolment files as Problems 3 & 5, so do it right after those to avoid merge overlap.
5. Problem 2 (candidate approval + fix/remove fake send-mail) — adds the new `approval_status` field to `Enrollment` (not a reuse of `EnrollmentStatus`) and consumes the Problem 0.5 email service for the contact form.
6. Problem 4 (`/administration` cleanup) — trivial once Problem 6 exists.
7. Problem 6 (navigation) — do last so it can link to everything fixed above (candidate enrolment w/ year, staff registration w/ exam field, administration hub, admin approvals).

For each problem: read the current file(s) listed, confirm they still match, make the change, then manually trace the flow end-to-end (form submit → API call → DB row → admin view) before moving on.
