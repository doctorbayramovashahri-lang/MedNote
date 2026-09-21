create extension if not exists pgcrypto;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id),
  full_name text not null,
  birth_date date not null,
  sex text null,
  phone text null,
  email text null,
  height_cm numeric(5,2) null,
  allergies text null,
  conditions text null,
  therapy text null,
  context_notes text null,
  about text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patients_sex_check check (sex is null or sex in ('female', 'male')),
  constraint patients_height_cm_check check (height_cm is null or height_cm > 0),
  constraint patients_id_doctor_id_unique unique (id, doctor_id)
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id),
  patient_id uuid not null,
  date date not null,
  format text not null default 'clinic',
  status text not null default 'draft',
  note text not null default '',
  decision text not null default '',
  next_step text not null default '',
  next_step_timing text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint visits_format_check check (format in ('clinic', 'online', 'phone')),
  constraint visits_status_check check (status in ('draft', 'completed')),
  constraint visits_version_check check (version > 0),
  constraint visits_patient_owner_fkey foreign key (patient_id, doctor_id)
    references public.patients(id, doctor_id),
  constraint visits_id_patient_id_doctor_id_unique unique (id, patient_id, doctor_id)
);

create table public.patient_weights (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id),
  patient_id uuid not null,
  value_kg numeric(5,2) not null,
  measured_at date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz null,
  constraint patient_weights_value_kg_check check (value_kg > 0),
  constraint patient_weights_patient_owner_fkey foreign key (patient_id, doctor_id)
    references public.patients(id, doctor_id)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id),
  patient_id uuid not null,
  visit_id uuid not null,
  kind text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_bucket text not null,
  storage_path text not null,
  added_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint attachments_kind_check check (kind in ('pdf', 'analysis-photo', 'document')),
  constraint attachments_size_bytes_check check (size_bytes >= 0),
  constraint attachments_storage_path_unique unique (storage_path),
  constraint attachments_patient_owner_fkey foreign key (patient_id, doctor_id)
    references public.patients(id, doctor_id),
  constraint attachments_visit_patient_owner_fkey foreign key (visit_id, patient_id, doctor_id)
    references public.visits(id, patient_id, doctor_id)
);

create unique index visits_one_draft_per_patient_doctor_idx
  on public.visits (doctor_id, patient_id)
  where status = 'draft';

create index patients_doctor_id_idx on public.patients (doctor_id);
create index visits_doctor_patient_date_idx on public.visits (doctor_id, patient_id, date desc, completed_at desc, started_at desc, created_at desc);
create index visits_patient_id_idx on public.visits (patient_id);
create index patient_weights_doctor_patient_measured_idx on public.patient_weights (doctor_id, patient_id, measured_at desc, created_at desc);
create index patient_weights_patient_id_idx on public.patient_weights (patient_id);
create index attachments_doctor_patient_visit_idx on public.attachments (doctor_id, patient_id, visit_id);
create index attachments_visit_id_idx on public.attachments (visit_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger patients_set_updated_at
  before update on public.patients
  for each row
  execute function public.set_updated_at();

create trigger visits_set_updated_at
  before update on public.visits
  for each row
  execute function public.set_updated_at();

create trigger patient_weights_set_updated_at
  before update on public.patient_weights
  for each row
  execute function public.set_updated_at();

alter table public.patients enable row level security;
alter table public.visits enable row level security;
alter table public.patient_weights enable row level security;
alter table public.attachments enable row level security;

grant select, insert, update, delete on public.patients to authenticated;
grant select, insert, update, delete on public.visits to authenticated;
grant select, insert, update, delete on public.patient_weights to authenticated;
grant select, insert, update, delete on public.attachments to authenticated;

create policy "patients_select_own"
  on public.patients
  for select
  to authenticated
  using (doctor_id = (select auth.uid()));

create policy "patients_insert_own"
  on public.patients
  for insert
  to authenticated
  with check (doctor_id = (select auth.uid()));

create policy "patients_update_own"
  on public.patients
  for update
  to authenticated
  using (doctor_id = (select auth.uid()))
  with check (doctor_id = (select auth.uid()));

create policy "patients_delete_own"
  on public.patients
  for delete
  to authenticated
  using (doctor_id = (select auth.uid()));

create policy "visits_select_own"
  on public.visits
  for select
  to authenticated
  using (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = visits.patient_id
        and p.doctor_id = (select auth.uid())
    )
  );

create policy "visits_insert_own"
  on public.visits
  for insert
  to authenticated
  with check (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = visits.patient_id
        and p.doctor_id = (select auth.uid())
    )
  );

create policy "visits_update_own"
  on public.visits
  for update
  to authenticated
  using (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = visits.patient_id
        and p.doctor_id = (select auth.uid())
    )
  )
  with check (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = visits.patient_id
        and p.doctor_id = (select auth.uid())
    )
  );

create policy "visits_delete_own"
  on public.visits
  for delete
  to authenticated
  using (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = visits.patient_id
        and p.doctor_id = (select auth.uid())
    )
  );

create policy "patient_weights_select_own"
  on public.patient_weights
  for select
  to authenticated
  using (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = patient_weights.patient_id
        and p.doctor_id = (select auth.uid())
    )
  );

create policy "patient_weights_insert_own"
  on public.patient_weights
  for insert
  to authenticated
  with check (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = patient_weights.patient_id
        and p.doctor_id = (select auth.uid())
    )
  );

create policy "patient_weights_update_own"
  on public.patient_weights
  for update
  to authenticated
  using (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = patient_weights.patient_id
        and p.doctor_id = (select auth.uid())
    )
  )
  with check (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = patient_weights.patient_id
        and p.doctor_id = (select auth.uid())
    )
  );

create policy "patient_weights_delete_own"
  on public.patient_weights
  for delete
  to authenticated
  using (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.patients p
      where p.id = patient_weights.patient_id
        and p.doctor_id = (select auth.uid())
    )
  );

create policy "attachments_select_own"
  on public.attachments
  for select
  to authenticated
  using (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.visits v
      where v.id = attachments.visit_id
        and v.patient_id = attachments.patient_id
        and v.doctor_id = (select auth.uid())
    )
  );

create policy "attachments_insert_own"
  on public.attachments
  for insert
  to authenticated
  with check (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.visits v
      where v.id = attachments.visit_id
        and v.patient_id = attachments.patient_id
        and v.doctor_id = (select auth.uid())
    )
  );

create policy "attachments_update_own"
  on public.attachments
  for update
  to authenticated
  using (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.visits v
      where v.id = attachments.visit_id
        and v.patient_id = attachments.patient_id
        and v.doctor_id = (select auth.uid())
    )
  )
  with check (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.visits v
      where v.id = attachments.visit_id
        and v.patient_id = attachments.patient_id
        and v.doctor_id = (select auth.uid())
    )
  );

create policy "attachments_delete_own"
  on public.attachments
  for delete
  to authenticated
  using (
    doctor_id = (select auth.uid())
    and exists (
      select 1
      from public.visits v
      where v.id = attachments.visit_id
        and v.patient_id = attachments.patient_id
        and v.doctor_id = (select auth.uid())
    )
  );
