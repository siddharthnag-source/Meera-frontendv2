alter table public.starred_messages
  add column if not exists user_context text;

update public.starred_messages
set user_context = ''
where user_context is null;

alter table public.starred_messages
  alter column user_context set default '';

alter table public.starred_messages
  alter column user_context set not null;
