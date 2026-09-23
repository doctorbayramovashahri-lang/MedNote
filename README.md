# MedNote

MedNote is a cloud-backed MVP in active development.

It is a personal workspace for a doctor to manage patients and clinical encounters.

Current stack:

- Vanilla HTML
- CSS
- JavaScript
- Supabase Auth
- Supabase Postgres
- Supabase private Storage

Current test data is fictitious/demo data only. Production medical data now uses Supabase as the source of truth. IndexedDB remains only as inactive legacy code and is not a fallback or sync target.

Before real medical data is used, enable and verify the remaining production security requirements documented in `docs/supabase-repository-contract.md`.

## Run Locally

From this directory:

```bash
python3 -m http.server 4174
```

Then open:

```text
http://localhost:4174/
```
