const fs = require('node:fs');
const prefix = `-- Empty synthetic project initialization only. No existing rows are copied.
begin;
do $$ begin
  if exists(select 1 from pg_tables where schemaname='public') then
    raise exception 'Refusing to bootstrap a nonempty public schema';
  end if;
end $$;
create table public.users (
  id text primary key default gen_random_uuid()::text,
  name text, email text, company_id integer, deleted boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  referral_id text, essence jsonb, memory_counter integer default 0,
  interaction_preferences jsonb, auth_id uuid unique references auth.users(id) on delete cascade
);
create table public.payments (
  payment_id text primary key, user_id text references public.users(id),
  payment_date timestamptz, amount integer, currency text not null default 'INR',
  plan_type text, order_id text, order_token double precision, coupon_code text,
  payment_method text, payment_status text, created_at timestamptz, updated_at timestamptz
);
create index payments_user_status_idx on public.payments(user_id,payment_status);
alter table public.users enable row level security;
alter table public.payments enable row level security;
revoke all on public.users, public.payments from anon,authenticated;
grant all on public.users,public.payments to service_role;
grant select on public.users,public.payments to authenticated;
create policy synthetic_own_profile on public.users for select to authenticated using(auth_id=auth.uid());
create policy synthetic_own_payments on public.payments for select to authenticated using(user_id in(select id from public.users where auth_id=auth.uid()));
create function public.bootstrap_synthetic_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.users(id,auth_id,email,name) values(new.id::text,new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name','Synthetic tester'))
  on conflict(auth_id) do nothing;
  return new;
end $$;
revoke all on function public.bootstrap_synthetic_profile() from public,anon,authenticated;
create trigger synthetic_auth_profile after insert on auth.users for each row execute function public.bootstrap_synthetic_profile();
`;
let access = fs.readFileSync('supabase/migrations/20260928101340_analytics_rbac_and_audit.sql', 'utf8');
// Do not copy the historical owner email seed into a synthetic database.
access = access.replace(/insert into public\.analytics_access[\s\S]*?on conflict \(email\) do nothing;/i, '');
const growth = fs.readFileSync('supabase/migrations/20260928150805_growth_links_and_attribution.sql', 'utf8');
const role = fs.readFileSync('supabase/migrations/20261026110000_growth_aggregate_role.sql', 'utf8');
const sql = prefix + access + '\n' + growth + '\n' + role + '\ncommit;\nselect count(*) as application_users from public.users;';
if (/xilapyewazpzlvqbbtgl|odeqnorudbdiuhweuoqv|insert into public\.users\s*\(/i.test(access + growth)) throw new Error('Unexpected existing-data reference or seed');
fs.mkdirSync('tmp/growth-staging', { recursive: true });
fs.writeFileSync('tmp/growth-staging/empty-commerce-schema.sql', sql);
console.log('Prepared empty users/payments and first-party growth schema; no customer rows or owner seed.');
