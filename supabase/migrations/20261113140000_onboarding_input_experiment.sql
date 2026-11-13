-- Additive, dark by default. Apply only after verifying the recovered release baseline.
-- Does not grant subscriptions, change payment data, or write profile values.
begin;
do $$ begin
  if to_regclass('public.meera_onboarding_drafts') is null then
    raise exception 'Verify the live onboarding draft schema before applying this migration';
  end if;
end $$;
create table public.onboarding_experiment_config (
  id text primary key check (id = 'onboarding_input_mode_v1'),
  enabled boolean not null default false,
  version integer not null default 1,
  enrollment_bps integer not null default 1000 check(enrollment_bps between 0 and 1000),
  max_assignments integer not null default 40 check(max_assignments between 1 and 40),
  starts_at timestamptz, stops_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.onboarding_experiment_config(id) values ('onboarding_input_mode_v1');
create table public.onboarding_experiment_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true
);
create table public.onboarding_experiment_qa (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.onboarding_experiment_acceptance (
  check_key text primary key, passed boolean not null default false,
  evidence_ref text, verified_by uuid references auth.users(id), verified_at timestamptz
);
insert into public.onboarding_experiment_acceptance(check_key)
select d || ':' || v || ':' || l || ':speech_correction_skip_save_reload'
from unnest(array['desktop_chrome','android_chrome','iphone_safari']) d
cross join unnest(array['sarah','brian']) v cross join unnest(array['en','hi','hinglish']) l;
insert into public.onboarding_experiment_acceptance(check_key)
select d || ':' || c from unnest(array['desktop_chrome','android_chrome','iphone_safari']) d
cross join unnest(array['denied_mic_typing','two_account_isolation','microphone_release','completed_onward','unpaid_checkout']) c;
insert into public.onboarding_experiment_acceptance(check_key) values
('release_baseline_verified'),('rollback_tested'),('reporting_access_verified'),('provider_budget_verified'),('telemetry_privacy_verified'),('measurement_integration_verified'),('onward_entitlement_verified');
create table public.onboarding_experiment_assignments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  variant text not null check(variant in ('typed_first','voice_first')),
  cohort text not null check(cohort in ('pilot','internal_qa')),
  assigned_at timestamptz not null default now(), signup_at timestamptz not null,
  exposure_at timestamptz, start_at timestamptz, saved_at timestamptz,
  useful_at timestamptz, workspace_at timestamptz,
  exposure_version integer,
  response_count integer not null default 0 check(response_count>=0),
  fallback_count integer not null default 0 check(fallback_count>=0)
);
create table public.onboarding_experiment_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.onboarding_experiment_assignments(user_id) on delete cascade,
  event_id uuid not null, event_name text not null check(event_name in
    ('start','mode_switch','response_ready','fallback','correction','optional_skip','workspace_arrived','useful_response_confirmed','unpaid_checkout_arrived','profile_saved')),
  duration_ms integer check(duration_ms between 0 and 300000),
  reason text check(reason in ('permission_denied','unsupported_device','provider_error','quota','autoplay_blocked','timeout')),
  mode text check(mode in ('typed_first','voice_first')),
  created_at timestamptz not null default now(), unique(user_id,event_id)
);
create index on public.onboarding_experiment_events(user_id,created_at);
create table public.onboarding_experiment_audit (
  id bigint generated always as identity primary key, actor uuid not null references auth.users(id),
  action text not null, config_version integer not null, created_at timestamptz not null default now()
);
-- No direct client writes, including to the switch, evidence, assignment or ledger.
do $$ declare t text; begin
  foreach t in array array['onboarding_experiment_config','onboarding_experiment_operators','onboarding_experiment_qa','onboarding_experiment_acceptance','onboarding_experiment_assignments','onboarding_experiment_events','onboarding_experiment_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end $$;

create function public.onboarding_experiment_operator() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.onboarding_experiment_operators where user_id=auth.uid() and enabled);
$$;
create function public.onboarding_experiment_assignment(p_expose boolean default false,p_version integer default null,p_qa boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.onboarding_experiment_config; a public.onboarding_experiment_assignments;
 u auth.users; draft_complete boolean; bucket integer; is_qa boolean; total integer;
begin
 select * into u from auth.users where id=auth.uid();
 if u.id is null or u.email_confirmed_at is null or coalesce(u.is_anonymous,false) or not exists(select 1 from auth.identities where user_id=u.id and provider='google') then raise exception 'AUTH_REQUIRED'; end if;
 -- Share the configuration lock with the control function, preventing stale exposure after disable.
 select * into c from public.onboarding_experiment_config where id='onboarding_input_mode_v1' for update;
 select * into a from public.onboarding_experiment_assignments where user_id=u.id;
 is_qa := lower(coalesce(u.email,'')) ~ '@(himeera\.com|getmeera\.space)$' or exists(select 1 from public.onboarding_experiment_qa where user_id=u.id);
 if p_qa and (not is_qa or not public.onboarding_experiment_operator()) then raise exception 'FORBIDDEN'; end if;
 if not p_qa and (not c.enabled or c.starts_at is null or now()>=c.stops_at) then
   return jsonb_build_object('enabled',false,'assigned',a.user_id is not null,'variant',a.variant,'exposed',a.exposure_at is not null,'version',c.version);
 end if;
 if a.user_id is null then
   select complete into draft_complete from public.meera_onboarding_drafts where user_id=u.id;
   if not p_qa and (is_qa or u.created_at<c.starts_at or u.created_at<now()-interval '24 hours' or coalesce(draft_complete,false)) then
     return jsonb_build_object('enabled',true,'assigned',false,'version',c.version);
   end if;
   bucket := (('x'||substr(md5(u.id::text||':onboarding_input_mode_v1:enrollment'),1,8))::bit(32)::bigint % 10000)::integer;
   select count(*) into total from public.onboarding_experiment_assignments where cohort='pilot';
   if not p_qa and (bucket>=c.enrollment_bps or total>=c.max_assignments) then
     return jsonb_build_object('enabled',true,'assigned',false,'version',c.version);
   end if;
   insert into public.onboarding_experiment_assignments(user_id,variant,cohort,signup_at)
   values(u.id, case when (('x'||substr(md5(u.id::text||':onboarding_input_mode_v1:arm'),1,8))::bit(32)::bigint % 2)=0 then 'typed_first' else 'voice_first' end,
     case when p_qa then 'internal_qa' else 'pilot' end,u.created_at) returning * into a;
 end if;
 if a.cohort='internal_qa' and not p_qa then return jsonb_build_object('enabled',false,'assigned',false,'version',c.version); end if;
 if p_expose and p_version is distinct from c.version then raise exception 'STALE_EXPOSURE'; end if;
 if p_expose then
   update public.onboarding_experiment_assignments set exposure_at=coalesce(exposure_at,now()),exposure_version=coalesce(exposure_version,c.version) where user_id=u.id returning * into a;
 end if;
 return jsonb_build_object('enabled',true,'assigned',true,'variant',a.variant,'version',c.version,'exposed',a.exposure_at is not null);
end $$;

create function public.onboarding_experiment_event(p_event_id uuid,p_event text,p_duration_ms integer default null,p_reason text default null,p_mode text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.onboarding_experiment_assignments; n integer;
begin
 select * into a from public.onboarding_experiment_assignments where user_id=auth.uid() for update;
 if a.user_id is null then return false; end if;
 if a.exposure_at is null and p_event not in ('workspace_arrived','useful_response_confirmed','unpaid_checkout_arrived') then return false; end if;
 if now()>a.assigned_at+interval '24 hours' then return false; end if;
 if p_event not in ('start','mode_switch','response_ready','fallback','correction','optional_skip','workspace_arrived','useful_response_confirmed','unpaid_checkout_arrived') then raise exception 'INVALID_EVENT'; end if;
 if p_event_id is null or (p_duration_ms is not null and p_duration_ms not between 0 and 300000) or (p_event='response_ready' and p_duration_ms is null) then raise exception 'INVALID_EVENT'; end if;
 if (p_reason is not null and p_reason not in ('permission_denied','unsupported_device','provider_error','quota','autoplay_blocked','timeout')) or (p_event='fallback' and p_reason is null) or (p_mode is not null and p_mode not in ('typed_first','voice_first')) or (p_event='mode_switch' and p_mode is null) then raise exception 'INVALID_EVENT'; end if;
 if exists(select 1 from public.onboarding_experiment_events where user_id=a.user_id and event_id=p_event_id) then return true; end if;
 select count(*) into n from public.onboarding_experiment_events where user_id=a.user_id;
 if n>=200 then raise exception 'RATE_LIMITED'; end if;
 if p_event='useful_response_confirmed' and a.workspace_at is null then raise exception 'WORKSPACE_REQUIRED'; end if;
 insert into public.onboarding_experiment_events(user_id,event_id,event_name,duration_ms,reason,mode) values(a.user_id,p_event_id,p_event,p_duration_ms,p_reason,p_mode);
 update public.onboarding_experiment_assignments set
   start_at=case when p_event='start' then coalesce(start_at,now()) else start_at end,
   workspace_at=case when p_event='workspace_arrived' then coalesce(workspace_at,now()) else workspace_at end,
   useful_at=case when p_event='useful_response_confirmed' then coalesce(useful_at,now()) else useful_at end,
   response_count=response_count+case when p_event='response_ready' then 1 else 0 end,
   fallback_count=fallback_count+case when p_event='fallback' then 1 else 0 end where user_id=a.user_id;
 return true;
end $$;

create function public.onboarding_experiment_saved() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.complete then
   update public.onboarding_experiment_assignments set saved_at=coalesce(saved_at,now()) where user_id=new.user_id and now()<=assigned_at+interval '24 hours';
 end if;
 return new;
end $$;
create trigger onboarding_experiment_profile_saved after insert or update of complete on public.meera_onboarding_drafts for each row execute function public.onboarding_experiment_saved();

create function public.onboarding_experiment_control(p_enabled boolean,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.onboarding_experiment_config; missing integer;
begin
 if not public.onboarding_experiment_operator() then raise exception 'FORBIDDEN'; end if;
 select * into c from public.onboarding_experiment_config where id='onboarding_input_mode_v1' for update;
 if c.version<>p_expected_version then raise exception 'STALE_CONFIG'; end if;
 if p_enabled then
   select count(*) into missing from public.onboarding_experiment_acceptance where not passed or evidence_ref is null;
   if missing>0 then raise exception 'ACCEPTANCE_REQUIRED'; end if;
   if now()>='2026-11-18 10:30:00+00'::timestamptz then raise exception 'PILOT_WINDOW_CLOSED'; end if;
   if c.stops_at is not null and now()>=c.stops_at then raise exception 'PILOT_WINDOW_CLOSED'; end if;
 end if;
 update public.onboarding_experiment_config set enabled=p_enabled,version=version+1,
   starts_at=case when p_enabled then coalesce(starts_at,now()) else starts_at end,
   stops_at=case when p_enabled then coalesce(stops_at,least(now()+interval '72 hours','2026-11-18 10:30:00+00'::timestamptz)) else stops_at end,
   updated_at=now() where id=c.id returning * into c;
 insert into public.onboarding_experiment_audit(actor,action,config_version) values(auth.uid(),case when p_enabled then 'enable' else 'disable' end,c.version);
 return to_jsonb(c);
end $$;
create function public.onboarding_experiment_accept(p_check text,p_passed boolean,p_evidence text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.onboarding_experiment_operator() then raise exception 'FORBIDDEN'; end if;
 if length(coalesce(p_evidence,'')) not between 8 and 500 or p_evidence !~ '^(https://|repo:)' then raise exception 'EVIDENCE_REQUIRED'; end if;
 update public.onboarding_experiment_acceptance set passed=p_passed,evidence_ref=p_evidence,verified_by=auth.uid(),verified_at=now() where check_key=p_check;
 if not found then raise exception 'UNKNOWN_CHECK'; end if;
 return true;
end $$;
create function public.onboarding_experiment_report() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.onboarding_experiment_operator() then raise exception 'FORBIDDEN'; end if;
 select jsonb_build_object(
 'config',(select to_jsonb(c) from public.onboarding_experiment_config c),
 'acceptance',(select jsonb_agg(to_jsonb(g) order by check_key) from public.onboarding_experiment_acceptance g),
 'arms',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
  select variant,count(*) assigned,count(*) filter(where exposure_at is not null) exposed, count(*) filter(where start_at is not null) started,
    count(*) filter(where now()>=assigned_at+interval '24 hours') matured,
    count(*) filter(where now()>=assigned_at+interval '24 hours' and useful_at is not null) matured_useful,
    count(*) filter(where now()>=assigned_at+interval '24 hours' and saved_at is not null) matured_saved,
    count(*) filter(where saved_at is not null) saved,count(*) filter(where workspace_at is not null) workspace_arrived,
    count(*) filter(where useful_at is not null) useful,
    sum(response_count) responses,sum(fallback_count) fallbacks,
    percentile_cont(0.5) within group(order by extract(epoch from saved_at-start_at)*1000) filter(where saved_at is not null and start_at is not null) start_to_save_median_ms,
    percentile_cont(0.5) within group(order by extract(epoch from saved_at-signup_at)*1000) filter(where saved_at is not null) signup_to_save_median_ms
   from public.onboarding_experiment_assignments where cohort='pilot' group by variant
 ) s),
 'response_latency',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
  select a.variant,count(*) measured,percentile_cont(.5) within group(order by e.duration_ms) p50_ms,percentile_cont(.95) within group(order by e.duration_ms) p95_ms
  from public.onboarding_experiment_events e join public.onboarding_experiment_assignments a on a.user_id=e.user_id
  where a.cohort='pilot' and e.event_name='response_ready' group by a.variant
 ) s),
 'event_counts',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
  select a.variant,e.event_name,e.reason,count(*) total from public.onboarding_experiment_events e join public.onboarding_experiment_assignments a on a.user_id=e.user_id
  where a.cohort='pilot' group by a.variant,e.event_name,e.reason
 ) s),
 'qa_assignments',(select count(*) from public.onboarding_experiment_assignments where cohort='internal_qa')
 ) into result;
 return result;
end $$;
revoke all on function public.onboarding_experiment_operator(),public.onboarding_experiment_assignment(boolean,integer,boolean),public.onboarding_experiment_event(uuid,text,integer,text,text),public.onboarding_experiment_control(boolean,integer),public.onboarding_experiment_accept(text,boolean,text),public.onboarding_experiment_report(),public.onboarding_experiment_saved() from public,anon;
grant execute on function public.onboarding_experiment_operator(),public.onboarding_experiment_assignment(boolean,integer,boolean),public.onboarding_experiment_event(uuid,text,integer,text,text),public.onboarding_experiment_control(boolean,integer),public.onboarding_experiment_accept(text,boolean,text),public.onboarding_experiment_report() to authenticated;
create function public.onboarding_experiment_status() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select jsonb_build_object('enabled',c.enabled and now()<c.stops_at,'assigned',true,'variant',a.variant,'exposed',a.exposure_at is not null,'version',c.version)
 from public.onboarding_experiment_assignments a cross join public.onboarding_experiment_config c where a.user_id=auth.uid()),jsonb_build_object('enabled',false,'assigned',false));
$$;
revoke all on function public.onboarding_experiment_status() from public,anon;
grant execute on function public.onboarding_experiment_status() to authenticated;

commit;
