# MedNote Supabase Repository Contract

Status: planning contract for the future Supabase repository. The current app still uses `dbRepository` backed by IndexedDB.

## Current UI Contract

The UI currently expects one repository object with asynchronous methods:

- `getPatients()`: returns normalized patient objects sorted by UI code.
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

## Visits Versioning

`visits.version` is the optimistic concurrency foundation. Future `updateVisit(id, input)` should:

- read or receive the current `version`;
- update with a condition like `id = id and version = expectedVersion`;
- increment `version` on success;
- return the updated visit including the new version;
- report a conflict distinctly so encounter autosave can reload or show a non-destructive conflict state.

The current UI does not pass an expected version, so the encounter workspace needs a small state addition before the cloud switch.

## Draft Conflict Handling

The database enforces one draft per `doctor_id + patient_id`. Future `getOrCreateDraftVisit(patientId)` should:

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

Supabase public browser configuration is limited to:

- project URL;
- publishable browser key.

The service role key, database password, OAuth tokens, and personal credentials must never be placed in frontend code or this repository.
