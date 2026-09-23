# MedNote Production Readiness

Status: Security & Operations Slice 11 audit.

Project:

- GitHub: `doctorbayramovashahri-lang/MedNote`
- Supabase project ref: `ddnhkwpdxcrvkfopkpmy`
- Supabase project name: `MedNote`
- Region: `eu-central-1`
- Organization: `MedNote`
- Organization plan: Free

This document contains no service role keys, database passwords, OAuth tokens, personal credentials, or real medical data.

## Auth Posture

MedNote uses Supabase email/password Auth behind a doctor-facing username form.

The current app maps:

```text
doctor -> doctor@mednote.local
```

The technical auth email is an implementation detail. It must not be presented as the doctor's contact email or patient-facing email.

Live Auth observations:

- One Supabase Auth user exists.
- The current user email is `doctor@mednote.local`.
- Provider is email/password.
- No MFA factors are enrolled.
- No real patient data rows are present.

Public signup, anonymous sign-ins, and manual identity linking must remain disabled for production. The available MCP tools did not expose direct read access to every hosted Auth toggle, so these specific dashboard toggles must be verified in Supabase Dashboard before first real medical data.

## Password Recovery Posture

Password recovery is not production-ready.

Current issue:

- The Auth account uses `doctor@mednote.local`.
- This is not a real deliverable inbox.
- A password reset email sent to this address would not reliably reach the doctor.

Required decision before real medical data:

- Keep the doctor-facing username UX.
- Move the underlying Supabase Auth account to a real controlled recovery email, or define an administrator-held recovery process with a real mailbox.
- Verify password reset end-to-end before storing real medical data.

## Leaked Password Protection

Supabase Security Advisor reports:

- `auth_leaked_password_protection`: WARN
- Status: disabled

Supabase documentation says leaked password protection checks proposed passwords against HaveIBeenPwned and rejects known compromised passwords. Supabase documentation also states this feature is available on Pro Plan and above.

Operational decision:

- Do not enable blindly during this slice.
- Current organization is on the Free plan.
- Upgrade/plan decision is required before this can be treated as closed.

Expected impact when available:

- Existing users may still sign in, but weak-password handling can affect sign-in and password-change flows.
- It should not inherently break MedNote's username-to-technical-email mapping, because the app still submits a normal Supabase email/password login.
- The actual doctor login must be smoke-tested immediately after enabling.

## MFA Decision

Decision: MFA REQUIRED BEFORE REAL MEDICAL DATA.

Rationale:

- The app will store personal medical data.
- The current project has one doctor account and no MFA factors.
- Supabase Auth supports TOTP MFA for project users.
- Supabase account/platform MFA also matters for administrator access.

Minimum app-user MFA UX before enforcing:

1. The doctor signs in with username and password.
2. MedNote offers or requires TOTP enrollment.
3. The doctor scans a QR code or enters the TOTP secret into an authenticator.
4. The doctor confirms the factor with a code.
5. On later login, MedNote detects AAL1 -> AAL2 and challenges for TOTP.
6. Recovery plan is defined before enforcement.

Recovery / lost-device requirement:

- Supabase documentation says recovery codes are not supported for project-user MFA; users can enroll multiple factors.
- For a single-doctor deployment, at least one backup TOTP factor or a documented admin recovery procedure is required before enforcing MFA.
- Avoid a full lockout by verifying recovery with a real deliverable admin/owner account before real medical data.

## Session Posture

Supabase Auth session behavior from current documentation:

- A session is created on sign-in.
- Access tokens are short-lived; the default recommended JWT expiration is one hour.
- Refresh tokens are single-use with reuse detection.
- By default, sessions can last until sign-out unless additional session limits are configured.
- Sign-out destroys refresh tokens/session records, but access tokens remain valid until their JWT expiry.

Current MedNote runtime:

- Calls `getSession()` on startup.
- Uses `onAuthStateChange`.
- Calls `supabase.auth.signOut()` on logout.
- Shows login-gated state when unauthenticated.

Recommendation:

- Current session posture is acceptable for testing.
- Before real medical data, decide whether to require inactivity timeout, time-boxed sessions, or single-session policy. Supabase documentation marks those controls as Pro Plan and above.

## Backup Capability

Current organization plan: Free.

Supabase documentation states:

- Pro, Team, and Enterprise projects have automatic daily database backups.
- Pro has 7 days of daily backups.
- Team has 14 days.
- Enterprise can have up to 30 days.
- Free projects should regularly export data using CLI/database dumps and maintain off-site backups.
- PITR is available as a paid add-on on paid plans and can restore to finer-grained points.

Current Postgres recovery posture:

- Automated daily backup capability is not considered available on the current Free plan.
- PITR is not available on the current Free plan.
- Maximum data-loss window is not acceptable for real medical data until an off-site backup or paid backup plan is defined and tested.

## Restore Capability

Database restore:

- Paid daily-backup restore is whole-project database restore, not individual-row recovery.
- Restore requires downtime.
- PITR can restore to a chosen point inside the available recovery window, but requires paid plan/add-on.

Current restore posture:

- Not verified for this project.
- No restore drill has been performed.
- This is a blocker before real medical data.

## Storage Recovery Capability

Storage bucket:

- `medical-attachments`
- Private bucket
- File size limit: 25 MB
- Object count: 0
- Versioning: disabled

Supabase documentation states database backups do not include objects stored via the Storage API; the database backup includes only metadata about those objects.

Risk:

- DB metadata can exist while the Storage object is missing.
- Storage object can exist while DB metadata is missing.
- A DB restore can create a mismatch if Storage is not restored to the same point.

Required before real documents:

- Define Storage backup/export strategy.
- Define restore drill for Postgres metadata plus Storage objects.
- Decide whether Storage versioning, external object backups, or scheduled export is required.

## Free Plan Limitations

Current organization plan: Free.

Supabase documentation states Free projects can be paused when they show low activity over a 7-day period, and paid projects are not subject to automatic inactivity pausing.

Availability risk:

- A paused project can make MedNote unavailable during a clinical encounter.
- This is an availability/reliability risk, separate from security.

Verdict:

- Free acceptable for development/testing only.
- Not acceptable for real medical data unless the owner explicitly accepts pause/unavailability risk and has a tested recovery plan.

## Keep-Alive Recommendation

If the Free plan is used temporarily for development:

- Use read-only, harmless health checks only.
- No patient writes.
- No visit writes.
- No attachment writes.
- No fake medical data.

Example strategy:

- Periodic authenticated or administrative read-only health query against a non-medical endpoint/table.

Do not implement scheduled keep-alive without separate confirmation.

## Owner / Admin Access Posture

Supabase MCP confirms the organization and project are accessible to the connected account, but it did not expose organization member/role enumeration in this environment.

Required before real medical data:

- Review Supabase organization members in Dashboard.
- Keep only required owners/admins/developers.
- Enable MFA on Supabase owner/admin accounts.
- Ensure at least two trusted recovery-capable admins or a documented owner account recovery path.

## GitHub / Repo Security Posture

Repository:

- `doctorbayramovashahri-lang/MedNote`
- Visibility: public
- Default branch: `main`
- GitHub Pages: enabled

Tracked files:

- `.gitignore`
- `README.md`
- `app.js`
- `styles.css`
- `index.html`
- `docs/supabase-repository-contract.md`
- Supabase migration files
- This production readiness document

Current scan result:

- No service role key found.
- No Supabase secret key found.
- No database password found.
- No OAuth/access/refresh tokens found in tracked source.
- Frontend contains the Supabase project URL and a browser-safe publishable key.
- Legacy anon key exists in Supabase project inventory, but the app uses the modern publishable key.
- No private medical content is committed.

## Security Advisor Findings

A - MUST FIX BEFORE REAL MEDICAL DATA:

- `auth_leaked_password_protection`: disabled.

B - SHOULD FIX SOON:

- Verify Auth dashboard toggles: public signup OFF, anonymous sign-ins OFF, manual linking OFF.
- Define and test MFA/recovery flow.
- Define and test backup/restore flow.
- Review Supabase organization access and GitHub collaborator access.

C - ACCEPTABLE / INFORMATIONAL:

- No RLS warning from Security Advisor.
- No function permission warning from Security Advisor.
- No Storage public access warning from Security Advisor.

## Performance Advisor Findings

Current informational findings:

- `visits_patient_id_idx` unused.
- `patient_weights_patient_id_idx` unused.
- `attachments_visit_id_idx` unused.

Classification:

- Informational for a young, near-empty MVP database.
- Do not remove indexes now.
- Reassess after realistic patient/visit volume.

## Privacy / Logging

Current source scan:

- No `console.*` logging found for medical data.
- Password is read from the login form only for Supabase Auth submission.
- Access/refresh tokens are not logged.
- Signed URLs are returned/opened but not logged.
- Controlled repository error messages avoid dumping full raw Supabase payloads into UI.

## Test Data Cleanliness

Live counts at Slice 11 audit:

- `patients = 0`
- `patient_weights = 0`
- `visits = 0`
- `attachments = 0`
- `storage_objects_medical_attachments = 0`

## Required Checklist Before First Real Medical Document

- [ ] Auth security accepted
- [ ] Password recovery verified
- [ ] MFA decision accepted
- [ ] Backup posture accepted
- [ ] Storage recovery posture accepted
- [ ] Plan/availability posture accepted
- [ ] Admin access reviewed
- [ ] Security Advisor A-findings = 0
- [ ] Test DB/storage empty
- [ ] Production smoke PASS after any Auth setting changes

## Known Accepted Risks

None accepted for real medical data yet.

Development-only accepted risks:

- Free plan availability limitations.
- No enrolled MFA factor.
- No tested password recovery.
- No tested backup/restore drill.
- Empty database with unused indexes.

## Final Slice 11 Classification

BLOCKED BEFORE REAL MEDICAL DATA

Exact blockers:

1. Leaked password protection is disabled and current org is Free.
2. Password recovery is not viable while the Auth email is `doctor@mednote.local`.
3. No MFA enrollment/recovery flow is implemented or tested.
4. Postgres backup/restore posture is not production-ready on Free.
5. Storage object backup/recovery is not defined or tested.
6. Free-plan project pause risk is unacceptable for clinical availability unless explicitly accepted.
7. Supabase organization/member access review was not available through the current MCP tools and must be completed in Dashboard.
