-- text.compare: database schema for optional accounts (Supabase)
--
-- Run the whole file in the Supabase SQL editor. It is safe to run again.
--
-- Everything a user saves is encrypted in the browser before it is sent here
-- (AES-256-GCM with a key that never leaves the browser unencrypted). The
-- database only ever holds ciphertext plus the minimum needed to run the
-- service: which user owns a row, whether it is history or saved, its size,
-- and timestamps.
--
-- Key handling: each user has one random data key. It is stored here only in
-- "wrapped" (encrypted) form: once under a key derived from their passphrase
-- (PBKDF2-SHA256), and optionally once under a recovery code shown to them a
-- single time. Changing the passphrase re-wraps the data key; nothing else
-- needs re-encrypting.

-- ---------------------------------------------------------------------------
-- 1. Wrapped encryption keys, one row per user
-- ---------------------------------------------------------------------------

create table if not exists public.user_keys (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  kdf                  text not null default 'PBKDF2-SHA256' check (kdf in ('PBKDF2-SHA256')),
  kdf_iterations       integer not null check (kdf_iterations between 100000 and 10000000),
  kdf_salt             text not null check (length(kdf_salt) between 16 and 128),
  wrapped_key          text not null check (length(wrapped_key) between 32 and 512),
  wrap_iv              text not null check (length(wrap_iv) between 12 and 64),
  -- optional second copy of the data key, wrapped with a one-time recovery code
  recovery_salt        text check (length(recovery_salt) between 16 and 128),
  recovery_wrapped_key text check (length(recovery_wrapped_key) between 32 and 512),
  recovery_iv          text check (length(recovery_iv) between 12 and 64),
  key_version          integer not null default 1 check (key_version > 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint recovery_all_or_nothing check (
    (recovery_salt is null and recovery_wrapped_key is null and recovery_iv is null) or
    (recovery_salt is not null and recovery_wrapped_key is not null and recovery_iv is not null)
  )
);

-- ---------------------------------------------------------------------------
-- 2. Saved comparisons and history
-- ---------------------------------------------------------------------------
-- meta_ct: small encrypted JSON (title, file names, language, options, stats)
--          so the list can be shown without downloading every comparison.
-- body_ct: the encrypted, compressed texts themselves.
-- Ciphertext and IVs are base64 text.

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('history', 'saved')),
  key_version integer not null default 1 check (key_version > 0),
  meta_iv     text not null check (length(meta_iv) between 12 and 64),
  meta_ct     text not null check (length(meta_ct) <= 65536),
  body_iv     text not null check (length(body_iv) between 12 and 64),
  body_ct     text not null check (length(body_ct) <= 12582912),   -- about 9 MB of ciphertext
  size_bytes  integer generated always as (length(meta_ct) + length(body_ct)) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists items_user_kind_updated_idx
  on public.items (user_id, kind, updated_at desc);

-- ---------------------------------------------------------------------------
-- 3. Triggers: timestamps, ownership, quotas and history trimming
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_keys_touch on public.user_keys;
create trigger user_keys_touch
  before insert or update on public.user_keys
  for each row execute function public.touch_updated_at();

-- Limits per user: 100 MB in total and 1,000 saved comparisons.
create or replace function public.items_enforce_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  used_bytes  bigint;
  saved_count integer;
begin
  select coalesce(sum(size_bytes), 0) into used_bytes
    from public.items
   where user_id = new.user_id and id <> new.id;

  if used_bytes + length(new.meta_ct) + length(new.body_ct) > 104857600 then
    raise exception 'Storage limit reached (100 MB). Delete some saved comparisons to make room.'
      using errcode = 'P0001', hint = 'quota_bytes';
  end if;

  if new.kind = 'saved' and (tg_op = 'INSERT' or old.kind <> 'saved') then
    select count(*) into saved_count
      from public.items
     where user_id = new.user_id and kind = 'saved';
    if saved_count >= 1000 then
      raise exception 'You can keep up to 1,000 saved comparisons. Delete some to save more.'
        using errcode = 'P0001', hint = 'quota_items';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists items_touch on public.items;
create trigger items_touch
  before insert or update on public.items
  for each row execute function public.touch_updated_at();

drop trigger if exists items_quota on public.items;
create trigger items_quota
  before insert or update on public.items
  for each row execute function public.items_enforce_quota();

-- History keeps each user's 200 most recent comparisons.
create or replace function public.items_trim_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.items
   where id in (
     select id
       from public.items
      where user_id = new.user_id and kind = 'history'
      order by updated_at desc
     offset 200
   );
  return null;
end;
$$;

drop trigger if exists items_trim_history on public.items;
create trigger items_trim_history
  after insert or update of kind on public.items
  for each row when (new.kind = 'history')
  execute function public.items_trim_history();

-- ---------------------------------------------------------------------------
-- 4. Row level security: every user sees and changes only their own rows
-- ---------------------------------------------------------------------------

alter table public.user_keys enable row level security;
alter table public.items enable row level security;

drop policy if exists "Users read their own key" on public.user_keys;
drop policy if exists "Users create their own key" on public.user_keys;
drop policy if exists "Users update their own key" on public.user_keys;
drop policy if exists "Users delete their own key" on public.user_keys;

create policy "Users read their own key" on public.user_keys
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their own key" on public.user_keys
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their own key" on public.user_keys
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their own key" on public.user_keys
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read their own items" on public.items;
drop policy if exists "Users create their own items" on public.items;
drop policy if exists "Users update their own items" on public.items;
drop policy if exists "Users delete their own items" on public.items;

create policy "Users read their own items" on public.items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their own items" on public.items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their own items" on public.items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their own items" on public.items
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Signed-out visitors get no access at all.
revoke all on public.user_keys, public.items from anon;
grant select, insert, update, delete on public.user_keys, public.items to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Functions the app calls
-- ---------------------------------------------------------------------------

-- How much the signed-in user is using, for the account screen.
create or replace function public.my_usage()
returns table (bytes_used bigint, saved_count integer, history_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(size_bytes), 0)::bigint,
         (count(*) filter (where kind = 'saved'))::integer,
         (count(*) filter (where kind = 'history'))::integer
    from public.items
   where user_id = (select auth.uid());
$$;

-- Delete everything the user has saved. With forget_key = true the encryption
-- key is removed too, so they start over with a new passphrase.
create or replace function public.delete_my_data(forget_key boolean default false)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  delete from public.items where user_id = uid;
  if forget_key then
    delete from public.user_keys where user_id = uid;
  end if;
end;
$$;

-- Delete the account itself. Removing the auth user cascades to every row
-- above, and Supabase removes the user's sessions and sign-in identities.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  delete from public.items where user_id = uid;
  delete from public.user_keys where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.my_usage() from public, anon;
revoke execute on function public.delete_my_data(boolean) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.my_usage() to authenticated;
grant execute on function public.delete_my_data(boolean) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. For the admin panel (server/): storage figures per user
-- ---------------------------------------------------------------------------
-- Counts and sizes only; the saved comparisons themselves are ciphertext.
-- Only the service key (used by the server, never the browser) may call it.

create or replace function public.admin_user_usage()
returns table (user_id uuid, saved_count integer, history_count integer, bytes_used bigint, last_activity timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select user_id,
         (count(*) filter (where kind = 'saved'))::integer,
         (count(*) filter (where kind = 'history'))::integer,
         coalesce(sum(size_bytes), 0)::bigint,
         max(updated_at)
    from public.items
   group by user_id;
$$;

revoke execute on function public.admin_user_usage() from public, anon, authenticated;
grant execute on function public.admin_user_usage() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Check the setup (optional): both tables should show rowsecurity = true
-- ---------------------------------------------------------------------------
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('user_keys', 'items');
-- select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename, cmd;
