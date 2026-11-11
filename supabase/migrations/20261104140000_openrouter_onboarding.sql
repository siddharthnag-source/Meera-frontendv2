-- Apply to CLEAN STAGING first. No new services or service-role credentials required by the app.
begin;
create table if not exists public.meera_onboarding_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  complete boolean not null default false,
  save_key uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.meera_onboarding_quota (
  scope text not null, window_start timestamptz not null, calls integer not null default 0,
  primary key(scope, window_start)
);
alter table public.meera_onboarding_drafts enable row level security;
alter table public.meera_onboarding_quota enable row level security;
revoke all on public.meera_onboarding_drafts, public.meera_onboarding_quota from anon, authenticated;
grant select on public.meera_onboarding_drafts to authenticated;
create policy onboarding_owner_read on public.meera_onboarding_drafts for select to authenticated using (user_id = auth.uid());

create or replace function public.onboarding_read_draft() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); result public.meera_onboarding_drafts;
begin
  if u is null or not exists(select 1 from auth.users where id = u and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.meera_onboarding_drafts(user_id) values (u) on conflict do nothing;
  select * into result from public.meera_onboarding_drafts where user_id = u;
  return jsonb_build_object('profile',result.profile,'revision',result.revision,'complete',result.complete);
end $$;

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
    if item.key not in ('name','job_details','dob','caste') then raise exception 'INVALID_PROFILE'; end if;
    if item.value = 'null'::jsonb and item.key <> 'name' then continue; end if;
    if jsonb_typeof(item.value) <> 'string' or length(btrim(item.value #>> '{}')) not between 1 and 500 then raise exception 'INVALID_PROFILE'; end if;
  end loop;
  if p_profile->>'dob' is not null then
    begin
      if (p_profile->>'dob') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_PROFILE'; end if;
      birthday := (p_profile->>'dob')::date;
      if birthday > current_date or extract(year from age(current_date,birthday)) > 120 then raise exception 'INVALID_PROFILE'; end if;
    exception when others then raise exception 'INVALID_PROFILE'; end;
  end if;
  if p_complete and (nullif(btrim(p_profile->>'name'),'') is null or not p_profile ? 'job_details' or not p_profile ? 'dob' or p_save_key is null) then raise exception 'INVALID_PROFILE'; end if;
  update public.meera_onboarding_drafts set profile=p_profile, revision=revision+1, complete=p_complete, save_key=p_save_key, updated_at=now() where user_id=u;
  return public.onboarding_read_draft();
end $$;

create or replace function public.onboarding_claim_quota() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); minute_start timestamptz := date_trunc('minute',now()); day_start timestamptz := date_trunc('day',now()); user_minute integer; user_day integer; global_day integer;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.onboarding_read_draft();
  perform pg_advisory_xact_lock(7152026); -- shared across instances; serializes check+increment
  select calls into user_minute from public.meera_onboarding_quota where scope=u::text||':minute' and window_start=minute_start;
  select calls into user_day from public.meera_onboarding_quota where scope=u::text||':day' and window_start=day_start;
  select calls into global_day from public.meera_onboarding_quota where scope='global:day' and window_start=day_start;
  if coalesce(user_minute,0)>=12 or coalesce(user_day,0)>=60 or coalesce(global_day,0)>=600 then return false; end if;
  insert into public.meera_onboarding_quota(scope,window_start,calls) values(u::text||':minute',minute_start,1),(u::text||':day',day_start,1),('global:day',day_start,1)
    on conflict(scope,window_start) do update set calls=public.meera_onboarding_quota.calls+1;
  delete from public.meera_onboarding_quota where window_start<day_start-interval '1 day';
  return true;
end $$;
revoke all on function public.onboarding_read_draft(), public.onboarding_write_draft(integer,jsonb,boolean,uuid), public.onboarding_claim_quota() from public, anon;
grant execute on function public.onboarding_read_draft(), public.onboarding_write_draft(integer,jsonb,boolean,uuid), public.onboarding_claim_quota() to authenticated;
commit;
