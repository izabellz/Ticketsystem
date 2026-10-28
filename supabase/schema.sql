-- Helpdesk schema for Supabase. Run in SQL Editor as project owner.
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'support');
create type public.ticket_status as enum ('open', 'in_progress', 'waiting', 'resolved', 'closed');
create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role public.app_role not null default 'support',
  created_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  subject text not null check (char_length(subject) between 4 and 160),
  description text not null check (char_length(description) between 10 and 10000),
  category text not null default 'Sonstiges' check (char_length(category) <= 80),
  status public.ticket_status not null default 'open',
  priority public.ticket_priority not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null default '' check (char_length(body) <= 10000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint message_has_content check (char_length(trim(body)) > 0 or is_internal = false)
);

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  message_id uuid references public.ticket_messages(id) on delete set null,
  uploader_id uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 8388608),
  created_at timestamptz not null default now()
);

create index tickets_owner_updated_idx on public.tickets(owner_id, updated_at desc);
create index tickets_status_updated_idx on public.tickets(status, updated_at desc);
create index messages_ticket_created_idx on public.ticket_messages(ticket_id, created_at);
create index attachments_ticket_idx on public.ticket_attachments(ticket_id);

-- Create a profile for each invited/authenticated user. The role is always support by default.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email,''),'@',1)), 'support')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_attachments enable row level security;

-- Profiles: users can read their own profile; admins can read all. No client-side role editing.
create policy "profiles_select_own_or_admin" on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_admin());
create policy "profiles_update_own_display_name" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, delete on public.profiles from anon, authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Tickets: users see their own; admins see all. Users can create tickets only for themselves.
create policy "tickets_select_owner_or_admin" on public.tickets for select to authenticated
using (owner_id = (select auth.uid()) or public.is_admin());
create policy "tickets_insert_owner" on public.tickets for insert to authenticated
with check (owner_id = (select auth.uid()));
create policy "tickets_update_admin_only" on public.tickets for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Messages: only participants of the ticket and admins can read. Users can reply only as themselves.
create policy "messages_select_participant" on public.ticket_messages for select to authenticated
using (
  public.is_admin() or (
    is_internal = false and exists (
      select 1 from public.tickets t where t.id = ticket_id and t.owner_id = (select auth.uid())
    )
  )
);
create policy "messages_insert_participant" on public.ticket_messages for insert to authenticated
with check (
  author_id = (select auth.uid()) and is_internal = false and exists (
    select 1 from public.tickets t where t.id = ticket_id
      and (t.owner_id = (select auth.uid()) or public.is_admin())
  )
);
-- No client updates/deletes for messages.

-- Attachment rows inherit ticket participant access.
create policy "attachments_select_participant" on public.ticket_attachments for select to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.tickets t where t.id = ticket_id and t.owner_id = (select auth.uid())
  )
);
create policy "attachments_insert_participant" on public.ticket_attachments for insert to authenticated
with check (
  uploader_id = (select auth.uid()) and exists (
    select 1 from public.tickets t where t.id = ticket_id
      and (t.owner_id = (select auth.uid()) or public.is_admin())
  )
);

-- Private bucket; never make this bucket public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-files', 'ticket-files', false, 8388608,
  array['image/png','image/jpeg','image/webp','application/pdf','text/plain','application/zip',
        'application/json','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = 8388608;

create policy "ticket_files_read_participant" on storage.objects for select to authenticated
using (
  bucket_id = 'ticket-files' and (
    public.is_admin() or exists (
      select 1 from public.ticket_attachments a
      join public.tickets t on t.id = a.ticket_id
      where a.storage_path = name and t.owner_id = (select auth.uid())
    )
  )
);
create policy "ticket_files_insert_own_ticket" on storage.objects for insert to authenticated
with check (
  bucket_id = 'ticket-files' and exists (
    select 1 from public.tickets t where t.id::text = (storage.foldername(name))[1]
      and (t.owner_id = (select auth.uid()) or public.is_admin())
  )
);
-- Optional: no direct object update/delete from clients. Use controlled admin cleanup if required.

-- IMPORTANT: after inviting your own account, promote exactly that account to admin from SQL Editor:
-- update public.profiles set role = 'admin' where email = 'YOUR-LOGIN-EMAIL';
-- Never expose the service_role key in the frontend or commit it to GitHub.