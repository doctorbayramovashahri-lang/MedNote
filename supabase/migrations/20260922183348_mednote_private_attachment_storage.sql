insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medical-attachments', 'medical-attachments', false, 26214400, null)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "medical_attachments_insert_own_namespace"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'medical-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "medical_attachments_select_own_namespace"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'medical-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "medical_attachments_delete_own_namespace"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'medical-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
