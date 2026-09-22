# MedNote Supabase Repository Contract

Status: foundation contract for the future Supabase repository. The current production app still uses `dbRepository` backed by IndexedDB.

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

## Supabase Repository Foundation

The app now contains a parallel read-only `supabaseRepository` implementation for the existing cloud schema. It is not connected to the production UI path yet.

Current production path:

```text
UI -> dbRepository -> IndexedDB
```

Prepared cloud path:

```text
UI -> repository contract -> supabaseRepository -> Supabase
```

The cloud foundation implements read methods only:

- `getPatients()`
- `getPatient(id)`
- `getVisits(patientId)`
- `getVisit(id)`
- `getAttachments(patientId, visitId = null)`

It also implements cloud patient write methods, still not connected to the production UI:

- `createPatient(input)`
- `updatePatient(id, input)`

It also implements cloud visit write foundation methods, still not connected to the production UI:

- `createVisit(patientId, input, files = [])`
- `getOrCreateDraftVisit(patientId)`
- `updateVisit(id, input)`

It also includes centralized mapping helpers for patients, patient weights, visits, and attachment metadata so snake_case/camelCase conversion does not leak into UI code.

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

Cloud attachment metadata does not fabricate `dataUrl`. UI work is still required before attachments can switch to Supabase Storage.

## Storage Path Contract

Future Supabase Storage objects should use this canonical private path shape:

```text
{doctor_id}/{patient_id}/{visit_id}/{attachment_id}/{safe-filename}
```

The attachment id is intentionally its own path segment. Storage bucket creation, Storage policies, upload/download, and signed URLs are out of scope for the current foundation slice.

## IndexedDB Assumptions Leaking Into UI

- Attachments are currently stored as full `dataUrl` values and can be opened directly from the row object.
- File reads happen in the UI before `createVisit()` and `addAttachment()` receive the file payload.
- Patient weight history is embedded inside each patient object, while the cloud schema stores weights in `patient_weights`.
- The UI assumes repository calls are fast enough to hydrate all visits and attachments for all patients on every route.
- Autosave in encounter mode repeatedly calls `updateVisit()` and assumes last write wins.
- `updateVisit()` has no returned version contract yet.

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

Future cloud attachment shape should preserve UI-friendly fields while adding Storage metadata:

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
  previewUrl
}
```

The UI should stop assuming `dataUrl` is always available. Image/PDF opening should go through `previewUrl` or a repository helper that can return a signed URL later.

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

Storage is not configured yet. If `files` contains any uploaded item, the method fails with a controlled repository error instead of silently ignoring files, saving local attachments, or creating fake attachment metadata. When `files` is empty, the visit row can be inserted and is returned as a normalized Visit.

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

The current UI does not pass an expected version, so the encounter workspace needs a small state addition before the cloud switch.

## Draft Conflict Handling

The database enforces one draft per `doctor_id + patient_id`. Cloud `getOrCreateDraftVisit(patientId)` now:

1. query for an existing draft;
2. if absent, try to insert one;
3. if the insert hits the partial unique index, query again and return the existing draft.

This keeps the current UI contract stable while handling concurrent tabs/devices.

## Required UI Changes Before Cloud Switch

- Stop storing attachment `dataUrl` as the only open mechanism.
- Carry `visit.version` through encounter state and update calls.
- Avoid full-route hydration of all visits and attachments when cloud latency matters.
- Add explicit loading/error states around repository calls that can fail due to network, auth expiry, RLS, or concurrency.
- Decide how local IndexedDB demo data is handled after login: keep local-only, migrate manually, or start with an empty cloud workspace.

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
