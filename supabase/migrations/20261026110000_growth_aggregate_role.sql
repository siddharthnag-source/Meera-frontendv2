-- Adds an assignable aggregate reporting role without granting it to anyone.
-- Apply in staging and verify permissions before any production rollout.
alter table public.analytics_access
  drop constraint if exists analytics_access_role_check;
alter table public.analytics_access
  add constraint analytics_access_role_check
  check (role in ('owner', 'product_growth', 'growth_aggregate', 'analyst', 'support'));
