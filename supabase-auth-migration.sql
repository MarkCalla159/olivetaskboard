-- Ejecuta este archivo si ya tenías instalada la versión anterior del tablero.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '', phone_number text not null default '', whatsapp_notifications_enabled boolean not null default true,
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles for select using (id = auth.uid() or public.is_admin());

alter table public.tasks add column if not exists created_by uuid references auth.users(id) on delete cascade;
alter table public.tasks add column if not exists assignee_id uuid references auth.users(id) on delete cascade;
do $$
begin
  -- Older installations used user_id. Fresh installations do not, so never
  -- reference that column directly in a migration.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'user_id'
  ) then
    execute 'update public.tasks set created_by = user_id where created_by is null';
    execute 'update public.tasks set assignee_id = user_id where assignee_id is null';
  end if;
  if exists (select 1 from public.tasks where created_by is null or assignee_id is null) then
    raise exception 'No se pueden completar los propietarios de tasks. Asigna created_by y assignee_id antes de continuar.';
  end if;
end $$;
alter table public.tasks alter column created_by set not null;
alter table public.tasks alter column assignee_id set not null;

alter table public.tasks enable row level security;
revoke all on public.tasks from anon;
grant select, insert, update, delete on public.tasks to authenticated;
revoke update on public.tasks from authenticated;
grant update (title, description, status, priority, due_date, assignee, labels) on public.tasks to authenticated;
drop policy if exists "Guests can read their own tasks" on public.tasks;
drop policy if exists "Guests can create their own tasks" on public.tasks;
drop policy if exists "Guests can update their own tasks" on public.tasks;
drop policy if exists "Guests can delete their own tasks" on public.tasks;
drop policy if exists "Users can read assigned tasks" on public.tasks;
drop policy if exists "Users can create their own tasks" on public.tasks;
drop policy if exists "Users can update visible tasks" on public.tasks;
drop policy if exists "Users can delete visible tasks" on public.tasks;
create policy "Users can read assigned tasks" on public.tasks for select using (auth.uid() = assignee_id or auth.uid() = created_by or public.is_admin());
create policy "Users can create their own tasks" on public.tasks for insert with check ((auth.uid() = created_by and auth.uid() = assignee_id) or public.is_admin());
create policy "Users can update visible tasks" on public.tasks for update
using (auth.uid() = assignee_id or auth.uid() = created_by or public.is_admin())
with check (auth.uid() = assignee_id or auth.uid() = created_by or public.is_admin());
create policy "Users can delete visible tasks" on public.tasks for delete using (auth.uid() = created_by or public.is_admin());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, display_name, phone_number) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''), coalesce(new.raw_user_meta_data->>'phone_number', '')); return new; end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
alter table public.profiles add column if not exists phone_number text not null default '';
alter table public.profiles add column if not exists whatsapp_notifications_enabled boolean not null default true;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_length') then alter table public.profiles add constraint profiles_display_name_length check (char_length(display_name) <= 80); end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_phone_format') then alter table public.profiles add constraint profiles_phone_format check (phone_number = '' or phone_number ~ '^\+[1-9][0-9]{7,14}$'); end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_title_length') then alter table public.tasks add constraint tasks_title_length check (char_length(trim(title)) between 1 and 300); end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_description_length') then alter table public.tasks add constraint tasks_description_length check (char_length(description) <= 5000); end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_assignee_length') then alter table public.tasks add constraint tasks_assignee_length check (char_length(assignee) <= 80); end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_labels_count') then alter table public.tasks add constraint tasks_labels_count check (cardinality(labels) <= 30); end if;
end $$;
insert into public.profiles (id, display_name, phone_number)
select id, coalesce(raw_user_meta_data->>'display_name', ''), coalesce(raw_user_meta_data->>'phone_number', '') from auth.users
on conflict (id) do nothing;
create index if not exists tasks_assignee_idx on public.tasks(assignee_id, status);
create table if not exists public.task_notification_events (
  event_key text primary key check (char_length(event_key) between 1 and 200),
  task_id uuid not null references public.tasks(id) on delete cascade,
  assignee_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('processing', 'sent', 'skipped', 'failed')),
  updated_at timestamptz not null default now()
);
alter table public.task_notification_events enable row level security;
revoke all on public.task_notification_events from anon, authenticated;
commit;

-- Después de crear la cuenta administradora:
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'admin@example.com');
