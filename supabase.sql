create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  phone_number text not null default '' check (phone_number = '' or phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_notifications_enabled boolean not null default true,
  role text not null default 'user' check (role in ('admin', 'user')),
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

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(), title text not null check (char_length(trim(title)) between 1 and 300),
  description text not null default '' check (char_length(description) <= 5000), status text not null default 'todo' check (status in ('todo','in_progress','in_review','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high')), due_date date,
  created_by uuid not null references auth.users(id) on delete cascade,
  assignee_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), assignee text not null default '' check (char_length(assignee) <= 80), labels text[] not null default '{}'::text[] check (cardinality(labels) <= 30)
);
alter table public.tasks enable row level security;
revoke all on public.tasks from anon;
grant select, insert, update, delete on public.tasks to authenticated;
-- El navegador nunca debe poder modificar la propiedad de una tarea.
revoke update on public.tasks from authenticated;
grant update (title, description, status, priority, due_date, assignee, labels) on public.tasks to authenticated;
drop policy if exists "Users can read assigned tasks" on public.tasks;
create policy "Users can read assigned tasks" on public.tasks for select using (auth.uid() = assignee_id or auth.uid() = created_by or public.is_admin());
drop policy if exists "Users can create their own tasks" on public.tasks;
create policy "Users can create their own tasks" on public.tasks for insert with check ((auth.uid() = created_by and auth.uid() = assignee_id) or public.is_admin());
drop policy if exists "Users can update visible tasks" on public.tasks;
create policy "Users can update visible tasks" on public.tasks for update
using (auth.uid() = assignee_id or auth.uid() = created_by or public.is_admin())
with check (auth.uid() = assignee_id or auth.uid() = created_by or public.is_admin());
drop policy if exists "Users can delete visible tasks" on public.tasks;
create policy "Users can delete visible tasks" on public.tasks for delete using (auth.uid() = created_by or public.is_admin());
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

create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40), created_at timestamptz not null default now()
);
alter table public.labels enable row level security;
revoke all on public.labels from anon;
grant select, insert, update, delete on public.labels to authenticated;
drop policy if exists "Users manage own labels" on public.labels;
create policy "Users manage own labels" on public.labels for all using (auth.uid() = user_id or public.is_admin()) with check (auth.uid() = user_id or public.is_admin());
create unique index if not exists labels_user_name_idx on public.labels (user_id, lower(trim(name)));

-- Ejecutar una vez después de crear la cuenta administradora:
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'admin@example.com');
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, display_name, phone_number) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''), case when coalesce(new.raw_user_meta_data->>'phone_number', '') ~ '^\+[1-9][0-9]{7,14}$' then new.raw_user_meta_data->>'phone_number' else '' end); return new; end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
insert into public.profiles (id, display_name, phone_number)
select id, coalesce(raw_user_meta_data->>'display_name', ''), coalesce(raw_user_meta_data->>'phone_number', '') from auth.users
on conflict (id) do nothing;
