-- ============================================================================
--  ملاحظات هامة — Supabase schema + Row Level Security
--  نفّذ هذا الملف كاملاً من: Supabase Dashboard → SQL Editor → New query
--  المشروع: https://kcfboyrrsltbtomiishj.supabase.co
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ============================================================================
--  1) PROFILES
--  صف واحد لكل مستخدم، مرتبط بجدول المصادقة auth.users
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  avatar_color text not null default 'emerald'
    check (avatar_color in ('emerald', 'indigo', 'rose', 'amber', 'sky', 'violet')),
  theme text not null default 'system'
    check (theme in ('light', 'dark', 'system')),
  layout text not null default 'grid'
    check (layout in ('grid', 'list')),
  sort text not null default 'updated-desc'
    check (sort in ('updated-desc', 'updated-asc', 'created-desc', 'title-asc')),
  welcome_seeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_length check (char_length(name) <= 60)
);

-- ============================================================================
--  2) NOTES
--  كل ملاحظة مرتبطة بمستخدم واحد، والحذف يتسلسل مع حذف الحساب
-- ============================================================================
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default ''
    check (char_length(title) <= 160),
  content text not null default ''
    check (char_length(content) <= 20000),
  category text not null default 'general'
    check (category in ('work', 'personal', 'study', 'ideas', 'tasks', 'general')),
  color text not null default 'default'
    check (color in ('default', 'sand', 'mint', 'sky', 'rose', 'violet')),
  pinned boolean not null default false,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- فهارس تسرّع جلب ملاحظات المستخدم وترتيبها
create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);

create index if not exists notes_user_pinned_idx
  on public.notes (user_id, pinned)
  where pinned = true;

create index if not exists notes_user_favorite_idx
  on public.notes (user_id, favorite)
  where favorite = true;

-- ============================================================================
--  3) updated_at TRIGGER
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ============================================================================
--  4) AUTO-CREATE PROFILE ON SIGNUP
--  security definer حتى يعمل حتى لو كانت RLS مفعّلة
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  display_name text;
  picked_color text;
  colors text[] := array['emerald', 'indigo', 'rose', 'amber', 'sky', 'violet'];
begin
  display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'مستخدم'
  );

  picked_color := colors[1 + floor(random() * array_length(colors, 1))::int];

  insert into public.profiles (id, name, avatar_color)
  values (new.id, left(display_name, 60), picked_color)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- إنشاء ملفات شخصية للمستخدمين الموجودين قبل تشغيل هذا الملف
-- (مثل حساب العرض التجريبي demo@notes.app)
insert into public.profiles (id, name, avatar_color)
select
  users.id,
  left(coalesce(
    nullif(trim(users.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
    'مستخدم'
  ), 60),
  (array['emerald', 'indigo', 'rose', 'amber', 'sky', 'violet'])[1 + floor(random() * 6)::int]
from auth.users as users
where not exists (
  select 1 from public.profiles as profiles where profiles.id = users.id
)
on conflict (id) do nothing;

-- ============================================================================
--  5) ROW LEVEL SECURITY
--  كل مستخدم يرى ويعدّل صفوفه فقط. لا يمكن لأي مستخدم قراءة ملاحظات غيره.
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.notes enable row level security;

-- PROFILES
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- NOTES
drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own"
  on public.notes for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own"
  on public.notes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own"
  on public.notes for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own"
  on public.notes for delete
  to authenticated
  using (auth.uid() = user_id);

-- ============================================================================
--  6) PRIVILEGES
--  RLS وحدها تحمي الصفوف، وهذه المنح تمنع الوصول المجهول تماماً.
-- ============================================================================
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.notes from anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.notes to authenticated;

-- دوال الـ Triggers لا تحتاج أن تكون قابلة للاستدعاء مباشرة
revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_user() from public;

-- ============================================================================
--  7) DELETE OWN ACCOUNT (RPC)
--  تحذف المستخدم من auth.users، فتتُحذف ملفاته وملاحظاته تلقائياً.
--  لا يمكن استدعاؤها إلا للمستخدم الحالي المسجّل.
--  الحساب التجريبي المشترك محمي من الحذف.
-- ============================================================================
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid := auth.uid();
begin
  if current_id is null then
    raise exception 'Not authenticated';
  end if;

  if exists (
    select 1
    from auth.users
    where id = current_id
      and lower(coalesce(email, '')) = 'demo@notes.app'
  ) then
    raise exception 'The shared demo account cannot be deleted';
  end if;

  delete from auth.users where id = current_id;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- ============================================================================
--  7b) حماية كلمة مرور الحساب التجريبي
--  يمنع أي زائر من تغيير كلمة مرور الحساب المشترك عبر Auth API.
-- ============================================================================
create or replace function public.protect_demo_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(old.email, '')) = 'demo@notes.app'
     and (
       new.email is distinct from old.email
       or new.encrypted_password is distinct from old.encrypted_password
       or coalesce(new.email_change, '') <> ''
       or coalesce(new.email_change_token_new, '') <> ''
       or coalesce(new.email_change_token_current, '') <> ''
       or coalesce(new.email_change_confirm_status, 0) <> 0
     ) then
    raise exception 'The shared demo account credentials cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_demo_account on auth.users;
create trigger protect_demo_account
  before update on auth.users
  for each row execute function public.protect_demo_account();

revoke all on function public.protect_demo_account() from public;

-- ============================================================================
--  8) تحديث ذاكرة PostgREST المؤقتة
--  يجعل الجداول الجديدة ظاهرة فوراً لواجهة REST.
-- ============================================================================
notify pgrst, 'reload schema';

-- ============================================================================
--  9) تحقق سريع (اختياري)
--  نفّذ هذه الاستعلامات بعد الإنشاء للتأكد من أن RLS مفعّلة.
-- ============================================================================
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename in ('profiles', 'notes');
--
-- select policyname, tablename, cmd from pg_policies
--   where schemaname = 'public' and tablename in ('profiles', 'notes')
--   order by tablename, policyname;
