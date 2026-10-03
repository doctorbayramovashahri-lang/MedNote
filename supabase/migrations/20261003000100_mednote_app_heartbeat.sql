create extension if not exists pgcrypto;

create table if not exists public.app_heartbeat (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  constraint app_heartbeat_name_unique unique (name),
  constraint app_heartbeat_name_not_blank_check check (length(btrim(name)) > 0)
);

insert into public.app_heartbeat (name)
values ('mednote')
on conflict (name) do nothing;

alter table public.app_heartbeat enable row level security;

revoke all on public.app_heartbeat from anon;
revoke all on public.app_heartbeat from authenticated;

grant select on public.app_heartbeat to anon;

drop policy if exists "app_heartbeat_select_public" on public.app_heartbeat;
create policy "app_heartbeat_select_public"
  on public.app_heartbeat
  for select
  to anon
  using (name = 'mednote');
