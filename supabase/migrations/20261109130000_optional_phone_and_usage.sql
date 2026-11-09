-- Optional phone and usage preferences. Apply after the two onboarding migrations, clean staging only.
begin;
create or replace function public.onboarding_write_draft(p_revision integer, p_profile jsonb, p_complete boolean, p_save_key uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); current_row public.meera_onboarding_drafts; item record; birthday date;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.onboarding_read_draft();
  select * into current_row from public.meera_onboarding_drafts where user_id = u for update;
  if current_row.complete and p_complete and p_save_key is not null and current_row.save_key = p_save_key then return public.onboarding_read_draft(); end if;
  if p_revision is null or current_row.revision <> p_revision or current_row.complete then raise exception 'STALE_DRAFT'; end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' or p_complete is null then raise exception 'INVALID_PROFILE'; end if;
  for item in select key,value from jsonb_each(p_profile) loop
    if item.key not in ('name','job_details','dob','caste','phone','usage') then raise exception 'INVALID_PROFILE'; end if;
    if item.value = 'null'::jsonb then continue; end if;
    if jsonb_typeof(item.value) <> 'string' or length(btrim(item.value #>> '{}')) not between 1 and 500 then raise exception 'INVALID_PROFILE'; end if;
  end loop;
  if p_profile->>'phone' is not null and (p_profile->>'phone') !~ '^\+?[0-9 ().-]{7,25}$' then raise exception 'INVALID_PROFILE'; end if;
  if p_profile->>'dob' is not null then
    begin
      if (p_profile->>'dob') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_PROFILE'; end if;
      birthday := (p_profile->>'dob')::date;
      if birthday > current_date or extract(year from age(current_date,birthday)) > 120 then raise exception 'INVALID_PROFILE'; end if;
    exception when others then raise exception 'INVALID_PROFILE'; end;
  end if;
  if p_complete and p_save_key is null then raise exception 'INVALID_PROFILE'; end if;
  update public.meera_onboarding_drafts set profile=p_profile, revision=revision+1, complete=p_complete, save_key=p_save_key, updated_at=now() where user_id=u;
  return public.onboarding_read_draft();
end $$;

revoke all on function public.onboarding_write_draft(integer,jsonb,boolean,uuid) from public, anon;
grant execute on function public.onboarding_write_draft(integer,jsonb,boolean,uuid) to authenticated;
commit;
