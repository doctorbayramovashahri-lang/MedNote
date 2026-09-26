create table public.medical_templates (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id),
  title text not null,
  indication text not null default '',
  note text not null default '',
  decision text not null default '',
  next_step text not null default '',
  next_step_timing text not null default '',
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medical_templates_title_not_blank_check check (length(btrim(title)) > 0)
);

create index medical_templates_doctor_active_updated_idx
  on public.medical_templates (doctor_id, is_archived, updated_at desc);

create trigger medical_templates_set_updated_at
  before update on public.medical_templates
  for each row
  execute function public.set_updated_at();

alter table public.medical_templates enable row level security;

grant select, insert, update on public.medical_templates to authenticated;

create policy "medical_templates_select_own"
  on public.medical_templates
  for select
  to authenticated
  using (doctor_id = (select auth.uid()));

create policy "medical_templates_insert_own"
  on public.medical_templates
  for insert
  to authenticated
  with check (doctor_id = (select auth.uid()));

create policy "medical_templates_update_own"
  on public.medical_templates
  for update
  to authenticated
  using (doctor_id = (select auth.uid()))
  with check (doctor_id = (select auth.uid()));
