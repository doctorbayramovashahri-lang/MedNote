# MedNote Supabase Repository Contract

Status: production runtime contract for the Supabase repository. The production app now uses `supabaseRepository` through a single `repository` boundary.

## Current UI Contract

The UI currently expects one repository object with asynchronous methods:

- `getPatients()`: returns normalized patient objects. Patient search/list sorting currently belongs to the UI code, not to the repository contract.
- `getPatient(id)`: returns one patient or `null`.
- `createPatient(input)`: creates a patient and optional initial weight history item, then returns the saved patient.
- `updatePatient(id, input)`: updates patient fields and appends a new weight history item when weight/date changed, then returns the saved patient.
- `getVisits(patientId)`: returns all visits for one patient.
- `createVisit(patientId, input, files)`: creates a completed visit and stores any uploaded files as attachments.
- `getVisit(id)`: returns one visit or `null`.
- `getOrCreateDraftVisit(patientId)`: returns the existing draft visit for a patient or creates one.
- `updateVisit(id, input)`: updates visit fields. The UI does not currently use the return value.
- `addAttachment(patientId, visitId, file)`: stores one attachment and returns it.
- `removeAttachment(id)`: removes one attachment. The UI does not currently use the return value.
- `getAttachments(patientId, visitId = null)`: returns attachments for a patient, optionally scoped to one visit.

All methods are already `async`, so a cloud repository can preserve the external call shape for most UI paths.

## Contracts That Can Stay Stable

- Patient list/detail methods can keep the same names and return normalized patient objects.
- Visit list/detail/create/update methods can keep the same names.
- Draft acquisition can keep `getOrCreateDraftVisit(patientId)` and translate a database unique-conflict into a second read.
- Attachment methods can keep the same names, but their return shape needs adaptation because Supabase Storage should not store Data URLs in table rows.
- The repository should derive `doctor_id` from the authenticated Supabase session and never require UI callers to pass it.

## Supabase Repository Runtime

The app contains a cloud `supabaseRepository` implementation for the existing cloud schema. Production medical data flows through a single active repository reference:

Current production path:

```text
UI -> repository -> supabaseRepository -> Supabase Postgres + private Storage
```

IndexedDB remains in the codebase as a legacy local implementation only. It is not the production source of truth, fallback, secondary read source, or dual-write target.

The cloud repository implements:

- `getPatients()`
- `getPatient(id)`
- `getVisits(patientId)`
- `getVisit(id)`
- `getAttachments(patientId, visitId = null)`
- `createPatient(input)`
- `updatePatient(id, input)`
- `createVisit(patientId, input, files = [])`
- `getOrCreateDraftVisit(patientId)`
- `updateVisit(id, input)`
- `addAttachment(patientId, visitId, file)`
- `removeAttachment(id)`
- `getAttachmentSignedUrl(id, expiresIn = 120)`

It also includes centralized mapping helpers for patients, patient weights, visits, and attachment metadata so snake_case/camelCase conversion does not leak into UI code.

Cloud hydrate currently reads patients first, then reads visits and attachments per patient. This N+1 shape is accepted as a temporary MVP compromise while the dataset is small. It should be replaced by batched reads or pagination before larger production use.

If cloud hydrate fails, the UI shows a controlled MedNote Cloud error state. It does not show stale IndexedDB data, demo data, or a false empty state.

## Cloud Mapping Rules

Patient rows map from cloud columns to the existing UI model:

- `full_name` -> `fullName`
- `birth_date` -> `birthDate`
- `height_cm` -> `heightCm`
- `allergies`, `conditions`, `therapy`, `context_notes` -> `medicalContext`
- `created_at`, `updated_at` -> `createdAt`, `updatedAt`

`patient_weights` rows are collected back into `patient.weightHistory[]` so the current UI weight contract remains unchanged.

Visit rows map into the existing visit model and may additionally carry:

- `completedAt`
- `version`

Cloud visit reads use clinical ordering:

```text
date DESC
completed_at DESC NULLS LAST
started_at DESC
created_at DESC
```

Attachment rows currently map metadata only:

- `original_filename` -> `name`
- `mime_type` -> `mime`
- `size_bytes` -> `size`
- `storage_bucket` -> `storageBucket`
- `storage_path` -> `storagePath`

Cloud attachment metadata does not fabricate `dataUrl`.

## Storage Path Contract

Supabase Storage objects use this canonical private path shape:

```text
{doctor_id}/{patient_id}/{visit_id}/{attachment_id}/{safe-filename}
```

The attachment id is intentionally its own path segment. The Storage bucket is `medical-attachments`, it is private, and Storage policies allow authenticated doctors to insert, select, and delete only objects whose first path segment matches their own `auth.uid()`.

Signed URLs are short-lived runtime artifacts. They are created on demand with a default TTL of 120 seconds and are not stored in Postgres.

## Legacy IndexedDB Assumptions Removed From Active UI

- Attachments used to be stored as full `dataUrl` values and opened directly from the row object.
- Active file reads now pass browser `File`/`Blob` payloads to the repository before `createVisit()` and `addAttachment()` upload them to private Storage.
- Patient weight history is embedded inside each patient object, while the cloud schema stores weights in `patient_weights`.
- The UI assumes repository calls are fast enough to hydrate all visits and attachments for all patients on every route.
- Autosave in encounter mode serializes `updateVisit()` and carries the returned cloud version forward.
- `updateVisit()` has a returned version contract.

## Return Shape Changes Needed For Storage

Current attachment shape:

```js
{
  id,
  patientId,
  visitId,
  kind,
  name,
  mime,
  dataUrl,
  addedAt,
  size
}
```

Cloud attachment shape preserves UI-friendly fields while adding Storage metadata:

```js
{
  id,
  patientId,
  visitId,
  kind,
  name,
  mime,
  size,
  addedAt,
  storageBucket,
  storagePath,
  hasBinaryUrl
}
```

The UI no longer treats `dataUrl` as the only way to open a file. Attachment opening goes through a resolver:

```text
attachment.dataUrl -> local IndexedDB URL
attachment.storagePath -> short-lived Supabase signed URL
```

Signed URLs are resolved on demand and are not stored in the database or long-lived application state. If URL resolution fails or the object is missing/expired, the UI shows a controlled message instead of a raw Supabase error.

## Doctor Ownership

The cloud repository should:

- call `supabase.auth.getSession()` or use the current session provided by the app auth layer;
- require a valid session before medical CRUD;
- set `doctor_id = session.user.id` for inserts;
- rely on RLS as the final enforcement layer;
- never accept `doctor_id` from UI input.

Current foundation reads require an authenticated Supabase session before querying medical tables. If no session is available, repository operations fail with a classified `AUTH` repository error.

Cloud patient writes also require an authenticated Supabase session. Insert payloads set `doctor_id` from `session.user.id`; update payloads never include `doctor_id`, so UI input cannot reassign ownership. RLS remains the final security boundary.

## Patient Write Behavior

`createPatient(input)` inserts a row into `patients`, optionally inserts one initial `patient_weights` row when the current form input contains both `currentWeightKg` and `weightMeasuredAt`, then returns the normalized patient model by reading it back through `getPatient(id)`.

`updatePatient(id, input)` first verifies that the current doctor can read the patient. It updates only patient fields represented by the current patient form contract and never overwrites ownership. If the form contains a weight value/date pair, it reads the latest existing weight and inserts a new `patient_weights` row only when the value or measurement date differs from that latest weight. Existing weight history is not destructively replaced.

Current partial failure semantics:

- if patient creation succeeds but initial weight insert fails, the repository attempts to delete the just-created patient row and then reports the original weight failure;
- if patient update succeeds but a later new-weight insert fails, the patient update may remain saved while the repository reports failure. A transactional RPC can tighten this later if the product needs all-or-nothing patient update plus weight insert.

## Repository Error Contract

Repository errors are classified into:

- `AUTH`
- `NETWORK`
- `PERMISSION`
- `CONFLICT`
- `UNKNOWN`

The current read foundation primarily uses `AUTH`, `NETWORK`, `PERMISSION`, and `UNKNOWN`. `CONFLICT` is reserved for later cloud write/versioning work.

Cloud visit writes now use `CONFLICT` for stale optimistic updates, missing version input for a cloud update, unique-draft races that cannot be resolved by rereading, and attachment writes attempted before the Storage foundation exists.

## Cloud Visit Write Behavior

`createVisit(patientId, input, files = [])` creates a cloud visit for the authenticated doctor and sets `doctor_id` from the Supabase session only. The method does not accept ownership fields from UI input.

When `files` contains uploaded items, cloud `createVisit()` creates the visit and stores each file through `addAttachment()`. It tracks successfully created attachments. If a later attachment fails, it attempts compensating cleanup in reverse order for already created attachments, then attempts to delete the just-created visit, and reports the original attachment failure rather than silently mixing local and cloud state.

`getOrCreateDraftVisit(patientId)` preserves the current UI contract while relying on the database invariant that only one draft may exist for `(doctor_id, patient_id)`. It first reads an existing draft. If none exists, it inserts a draft. If a concurrent insert wins the partial unique index race, it rereads the draft and returns that row.

`updateVisit(id, input)` is optimistic and requires the caller to provide the current visit version as `input.expectedVersion` or `input.version`. It updates only when the visit id, authenticated doctor, and expected version all match. On success it writes `version = expectedVersion + 1` and returns the normalized updated Visit. If no row is updated, the method reports `CONFLICT` instead of retrying or overwriting medical text.

When a visit is completed through `updateVisit()`, `status` becomes `completed` and `completed_at` is set when the caller did not provide an explicit value. Version semantics still apply. A completed visit no longer matches the draft query, so a later `getOrCreateDraftVisit(patientId)` can create a new draft.

## Visits Versioning

`visits.version` is the optimistic concurrency foundation. Cloud `updateVisit(id, input)` now:

- receives the current `version` as `input.expectedVersion` or `input.version`;
- updates with `id`, authenticated `doctor_id`, and `version = expectedVersion`;
- writes `version = expectedVersion + 1` on success;
- return the updated visit including the new version;
- report a conflict distinctly so encounter autosave can reload or show a non-destructive conflict state.

The encounter workspace now carries the last successfully loaded or saved Visit as the authoritative client version source. It passes `expectedVersion` from that Visit, not from DOM state. A successful repository response replaces the in-memory Visit and its returned `version` becomes the version for the next save.

Autosave requests are serialized so a later edit waits for the previous save to return before using the next expected version. The UI does not fake-increment versions before the repository responds.

On `RepositoryError(CONFLICT)`, autosave stops for the current Visit and the existing status area tells the user that the record changed elsewhere and should be refreshed before continuing. The form is not rerendered, so the unsaved local text remains visible. The UI does not automatically retry, overwrite, merge, or replace the user's local form content.

Supabase is the production source of truth. The legacy local repository accepts the same `expectedVersion` shape for compatibility if manually reactivated during development, but local storage is not active and is not intended to emulate server-side conflict detection.

## Cloud Attachment Behavior

`addAttachment(patientId, visitId, file)` requires an authenticated session and first verifies that the Visit is available to the current doctor through RLS. It then generates an attachment UUID, builds the canonical Storage path, validates that the file is present and not larger than the configured 25 MB limit, uploads the object with `upsert: false`, and inserts metadata into `public.attachments`.

If Storage upload fails, no metadata row is created. If metadata insert fails after a successful upload, the repository attempts to remove the uploaded object and then reports the original metadata failure.

`removeAttachment(id)` reads owned metadata first, deletes the private Storage object, and only then deletes the metadata row. If object deletion fails, metadata remains visible so the operation can be retried. If object deletion succeeds but metadata deletion fails, a stale metadata row may remain but the private object is already gone; that state is recoverable by retry or audit.

`getAttachmentSignedUrl(id, expiresIn)` reads owned metadata through RLS and creates a short-lived signed URL for the private object. The URL is not stored in application state or database rows.

The production repository source uses cloud attachment metadata and private Storage objects. Attachment rendering/opening resolves `storagePath` into a short-lived signed URL on demand. Signed URLs are not stored in database rows or long-lived application state.

Legacy local `dataUrl` compatibility remains in the resolver for old IndexedDB-shaped objects, but the active production upload path passes browser `File`/`Blob` objects to Supabase Storage and does not create new Data URLs.

## Draft Conflict Handling

The database enforces one draft per `doctor_id + patient_id`. Cloud `getOrCreateDraftVisit(patientId)` now:

1. query for an existing draft;
2. if absent, try to insert one;
3. if the insert hits the partial unique index, query again and return the existing draft.

This keeps the current UI contract stable while handling concurrent tabs/devices.

## Runtime Cutover Behavior

An authenticated empty Supabase workspace is a real empty MedNote state. The app does not seed demo patients after login and does not automatically import local IndexedDB data.

Medical repository errors are surfaced as controlled UI states or messages:

- `AUTH`: ask the doctor to sign in again;
- `NETWORK`: ask to check the connection and retry;
- `PERMISSION`: explain that the data is not available;
- `CONFLICT`: preserve local form content and stop autosave without retry or merge;
- `UNKNOWN`: show a generic MedNote Cloud failure.

## Runtime Hardening Notes

The active runtime now disables patient and visit submit buttons while their save is in flight. Start-encounter and attachment add/delete actions also guard against repeat clicks while the cloud request is pending. These UI guards reduce accidental duplicate operations, but the database constraints and RLS remain the source of truth.

Attachment and signed URL behavior is intentionally conservative:

- signed URLs are short-lived and created only on demand;
- missing objects or failed signed URL creation show a controlled "file unavailable" message;
- metadata is not silently removed when object deletion fails;
- object/metadata mismatch repair is an administrative audit concern, not automatic product behavior.

Known cloud MVP debt:

- hydrate uses an N+1 pattern: one patient query, then one visit query and one attachment query per patient. For `N` patients this is `1 + 2N` medical reads, plus patient weight reads inside the patient repository. This is acceptable for tiny MVP datasets and should become batched reads or pagination before larger production use.
- patient delete is intentionally absent from the product UI. Test cleanup and administrative deletion must be explicit and scoped to known test rows.
- IndexedDB code remains as inactive legacy code and should not be treated as a fallback.

## Production Readiness Checklist Before Real Medical Data

Required before real medical data:

- enable Supabase leaked password protection;
- define an MFA policy for doctor accounts and test account recovery UX;
- verify public signup and anonymous sign-in remain disabled for the intended deployment;
- document operational access to backups/restore and the limits of the current Supabase plan;
- decide whether to move from Free to a paid Supabase plan before storing real patient data;
- define a harmless keep-alive strategy only if Free-plan auto-pause would disrupt development. Do not use dummy medical writes for keep-alive.

Security Advisor currently reports leaked password protection as disabled. Performance Advisor currently reports unused indexes on the young MVP dataset; this is informational until realistic query volume exists.

## Current Auth Boundary

The app now gates the local IndexedDB MVP behind Supabase Auth. This proves login, restored session, logout, and route protection, but it does not make local medical data cloud-owned yet.

The doctor-facing login form accepts a simple username and password. MedNote normalizes the username and maps it to an internal technical email for Supabase Auth:

```text
doctor -> doctor@mednote.local
```

That technical email is an implementation detail for Supabase email/password Auth. It is not the doctor's contact email and should not be shown in the ordinary login flow.

Supabase public browser configuration is limited to:

- project URL;
- publishable browser key.

The service role key, database password, OAuth tokens, and personal credentials must never be placed in frontend code or this repository.
