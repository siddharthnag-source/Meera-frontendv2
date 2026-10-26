-- Apply ONLY in clean synthetic project wyitdnwftdxlibdnldfe.
-- No production data, AI service binding or production access is granted.
begin;
create table if not exists public.growth_staging_operators (
  email text primary key check(email=lower(email)), enabled boolean not null default true
);
create table if not exists public.growth_staging_experiments (
  id text primary key, enabled boolean not null default false,
  allocation integer not null default 0 check(allocation between 0 and 100), updated_at timestamptz not null default now()
);
create table if not exists public.growth_staging_assignments (
  experiment_id text references public.growth_staging_experiments(id), auth_user_id uuid references auth.users(id) on delete cascade,
  variant text not null check(variant in ('control','treatment')), exposed_at timestamptz,
  created_at timestamptz not null default now(), primary key(experiment_id,auth_user_id)
);
-- Serialize writes against the configuration row so a committed kill switch
-- also blocks requests that read the old enabled value just before the switch.
create or replace function public.enforce_growth_staging_enabled() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare active boolean;
begin
  select enabled into active from public.growth_staging_experiments where id=new.experiment_id for share;
  if not coalesce(active,false) then raise exception 'Staging experiment is disabled'; end if;
  return new;
end $$;
revoke all on function public.enforce_growth_staging_enabled() from public,anon,authenticated;
drop trigger if exists growth_staging_enabled on public.growth_staging_assignments;
create trigger growth_staging_enabled before insert or update on public.growth_staging_assignments
for each row execute function public.enforce_growth_staging_enabled();
alter table public.growth_staging_operators enable row level security;
alter table public.growth_staging_experiments enable row level security;
alter table public.growth_staging_assignments enable row level security;
revoke all on public.growth_staging_operators,public.growth_staging_experiments,public.growth_staging_assignments from public,anon,authenticated;
grant all on public.growth_staging_operators,public.growth_staging_experiments,public.growth_staging_assignments to service_role;
insert into public.growth_staging_experiments(id,enabled,allocation) values('growth_readiness_v1',false,0) on conflict(id) do nothing;
insert into public.growth_staging_operators(email) values('aryaratan@himeera.com'),('marketing@getmeera.space') on conflict(email) do nothing;
commit;
select 'Synthetic workbench initialized disabled; server-only access' as result;
