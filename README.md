# MedNote

MedNote is a Local MVP in active development.

It is a personal workspace for a doctor to manage patients and clinical encounters locally in the browser.

Current stack:

- Vanilla HTML
- CSS
- JavaScript
- IndexedDB
- Supabase Auth

The current bundled data is fictitious demo data for local testing and product evaluation. Supabase Auth is connected for login/session gating, but patient and encounter data still stay in local IndexedDB.

## Run Locally

From this directory:

```bash
python3 -m http.server 4174
```

Then open:

```text
http://localhost:4174/
```
