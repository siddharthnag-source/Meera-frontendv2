-- analytics_events already has RLS enabled and is writable only by service_role.
-- No additional public data access is needed for browser conversion tracking.
create unique index if not exists analytics_meta_registration_once_idx
  on public.analytics_events (user_id)
  where event_name = 'meta_registration_claimed';
