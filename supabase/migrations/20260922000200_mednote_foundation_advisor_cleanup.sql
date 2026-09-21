create index visits_patient_doctor_fk_idx
  on public.visits (patient_id, doctor_id);

create index patient_weights_patient_doctor_fk_idx
  on public.patient_weights (patient_id, doctor_id);

create index attachments_patient_doctor_fk_idx
  on public.attachments (patient_id, doctor_id);

create index attachments_visit_patient_doctor_fk_idx
  on public.attachments (visit_id, patient_id, doctor_id);

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public;
    revoke execute on function public.rls_auto_enable() from anon;
    revoke execute on function public.rls_auto_enable() from authenticated;
  end if;
end;
$$;
