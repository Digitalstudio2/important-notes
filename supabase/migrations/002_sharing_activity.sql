-- ============================================================================
--  002_sharing_activity.sql
--  المرحلة 1: مشاركة الملاحظات للقراءة فقط + سجل النشاط
--
--  الهدف:
--   - رابط مشاركة سري لكل ملاحظة، صالح 7 أيام، للقراءة فقط.
--   - لا يُخزَّن الرمز (token) نفسه؛ يُخزَّن SHA-256 فقط.
--   - إظهار اسم المالك (ولون صورته) دون بريده أو معرّفه.
--   - سجل نشاط لكل الأحداث المهمة: الملاحظات، المشاركة، الملف الشخصي،
--     تسجيل الدخول، إنشاء الحساب، تغيير كلمة المرور.
--   - الحساب التجريبي: لا مشاركة ولا سجل نشاط، مع دالة إعادة تعيين
--     ملاحظاته السبع عند الدخول الصريح.
--
--  طريقة التطبيق:
--   psql "$CONNECTION_STRING" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/002_sharing_activity.sql
--
--  ملاحظات:
--   - لا يحذف هذا الملف أي جدول أو عمود أو بيانات موجودة.
--   - كل الدوال الحساسة SECURITY DEFINER مع search_path = ''.
--   - أي فشل في التحقق الداخلي يتراجع عن المعاملة بالكامل.
--   - auth.users مملوك لـ supabase_auth_admin، لذا لا ننشئ مشغّلاً جديداً عليه؛
--     نعيد تعريف handle_new_user (المملوك لـ postgres) لتسجيل إنشاء الحساب،
--     ونسجّل الدخول/تغيير كلمة المرور عبر record_auth_event من العميل.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) جدول روابط المشاركة
--    token_hash = SHA-256 للرمز. لا يوجد عمود للرمز الصريح إطلاقاً.
-- ----------------------------------------------------------------------------
create table if not exists public.note_shares (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint note_shares_token_hash_length check (octet_length(token_hash) = 32),
  constraint note_shares_expiry_after_creation check (expires_at > created_at)
);

create index if not exists note_shares_owner_active_idx
  on public.note_shares (owner_id, note_id)
  where revoked_at is null;

comment on table public.note_shares is
  'روابط مشاركة للقراءة فقط. يُخزَّن تجزئة SHA-256 للرمز فقط، ولا يُخزَّن الرمز الصريح.';
comment on column public.note_shares.token_hash is
  'SHA-256 (32 بايت) للرمز السري. الرمز الصريح يُعاد مرة واحدة فقط عند الإنشاء.';

-- ----------------------------------------------------------------------------
-- 2) جدول سجل النشاط
-- ----------------------------------------------------------------------------
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activity_log_event_type_check check (event_type in (
    'account_created',
    'login',
    'password_changed',
    'profile_updated',
    'note_created',
    'note_updated',
    'note_deleted',
    'share_created',
    'share_revoked'
  )),
  constraint activity_log_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists activity_log_user_created_idx
  on public.activity_log (user_id, created_at desc, id desc);

comment on table public.activity_log is
  'سجل نشاط خاص بكل مستخدم. لا يحتوي محتوى الملاحظات، ويُقرأ عبر RPC فقط.';

-- ----------------------------------------------------------------------------
-- 3) RLS
-- ----------------------------------------------------------------------------
alter table public.note_shares enable row level security;
alter table public.activity_log enable row level security;

-- لا سياسة على note_shares: لا وصول مباشر إطلاقاً. الوصول عبر RPC فقط.
drop policy if exists "note_shares_select_own" on public.note_shares;

-- سياسة احتياطية لسجل النشاط في حال منح SELECT مستقبلاً.
drop policy if exists "activity_log_select_own" on public.activity_log;
create policy "activity_log_select_own"
  on public.activity_log for select
  to authenticated
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 4) الصلاحيات: لا وصول جدولي مباشر؛ RPC فقط
-- ----------------------------------------------------------------------------
revoke all on table public.note_shares from anon, authenticated;
revoke all on table public.activity_log from anon, authenticated;

grant all on table public.note_shares to service_role;
grant all on table public.activity_log to service_role;

do $$
begin
  if exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
      and c.relname = 'activity_log_id_seq'
  ) then
    execute 'grant usage, select on sequence public.activity_log_id_seq to service_role';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 5) دوال مساعدة
-- ----------------------------------------------------------------------------

-- هل المستخدم هو الحساب التجريبي المشترك (أو مستخدم مجهول)؟
create or replace function public.is_demo_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (lower(coalesce(users.email, '')) = 'demo@notes.app'
            or coalesce(users.is_anonymous, false))
    from auth.users as users
    where users.id = p_user_id
  ), false);
$$;

revoke all on function public.is_demo_account(uuid) from public, anon, authenticated;

-- تسجيل حدث بشكل آمن: لا يكسر العملية الأساسية إذا فشل السجل.
create or replace function public.record_activity(
  p_user_id uuid,
  p_event_type text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;

  -- لا سجل للحساب التجريبي أو المستخدمين المجهولين.
  if public.is_demo_account(p_user_id) then
    return;
  end if;

  insert into public.activity_log (user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_user_id,
    p_event_type,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
exception
  when others then
    -- التسجيل لا يجب أن يمنع حفظ ملاحظة أو تسجيل دخول.
    null;
end;
$$;

revoke all on function public.record_activity(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) مشغّلات سجل النشاط
-- ----------------------------------------------------------------------------

-- الملاحظات: إنشاء / تعديل / حذف
create or replace function public.log_note_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    perform public.record_activity(
      new.user_id,
      'note_created',
      'note',
      new.id,
      jsonb_build_object(
        'title', left(coalesce(new.title, ''), 120),
        'category', new.category
      )
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if new.title is distinct from old.title then changed := array_append(changed, 'title'); end if;
    if new.content is distinct from old.content then changed := array_append(changed, 'content'); end if;
    if new.category is distinct from old.category then changed := array_append(changed, 'category'); end if;
    if new.color is distinct from old.color then changed := array_append(changed, 'color'); end if;
    if new.pinned is distinct from old.pinned then changed := array_append(changed, 'pinned'); end if;
    if new.favorite is distinct from old.favorite then changed := array_append(changed, 'favorite'); end if;

    -- لا نسجّل تحديث updated_at وحده (مثلاً تحديثاً بلا تغيير فعلي).
    if cardinality(changed) > 0 then
      perform public.record_activity(
        new.user_id,
        'note_updated',
        'note',
        new.id,
        jsonb_build_object(
          'title', left(coalesce(new.title, ''), 120),
          'category', new.category,
          'changed', to_jsonb(changed)
        )
      );
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_activity(
      old.user_id,
      'note_deleted',
      'note',
      old.id,
      jsonb_build_object(
        'title', left(coalesce(old.title, ''), 120),
        'category', old.category
      )
    );
    return old;
  end if;

  return null;
end;
$$;

revoke all on function public.log_note_activity() from public, anon, authenticated;

-- الملف الشخصي: الاسم أو لون الصورة فقط (لا تفضيلات المظهر المتكررة).
create or replace function public.log_profile_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed text[] := array[]::text[];
begin
  if new.name is distinct from old.name then changed := array_append(changed, 'name'); end if;
  if new.avatar_color is distinct from old.avatar_color then changed := array_append(changed, 'avatar_color'); end if;

  if cardinality(changed) > 0 then
    perform public.record_activity(
      new.id,
      'profile_updated',
      'profile',
      new.id,
      jsonb_build_object(
        'changed', to_jsonb(changed),
        'name', left(coalesce(new.name, ''), 60)
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_profile_activity() from public, anon, authenticated;

-- المصادقة: إنشاء الحساب يُسجَّل من داخل handle_new_user (المشغّل الحالي
-- على auth.users). لا يمكن لمالك قاعدة البيانات إنشاء مشغّل جديد على
-- auth.users لأن الجدول مملوك لـ supabase_auth_admin، لذا نعيد تعريف
-- الدالة الحالية فقط (وهي مملوكة لـ postgres).
-- تسجيل الدخول وتغيير كلمة المرور يُسجَّلان عبر record_auth_event من العميل.
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

  perform public.record_activity(
    new.id,
    'account_created',
    'account',
    new.id,
    jsonb_build_object('provider', coalesce(new.raw_app_meta_data ->> 'provider', 'email'))
  );

  return new;
end;
$$;

-- RPC لتسجيل أحداث المصادقة التي لا يمكن التقاطها على مستوى القاعدة
-- (تسجيل الدخول وتغيير كلمة المرور). مقيّد بنوعي الحدث وبالمستخدم الحالي.
create or replace function public.record_auth_event(p_event_type text)
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

  if p_event_type is null or p_event_type not in ('login', 'password_changed') then
    raise exception 'Unsupported auth event';
  end if;

  if public.is_demo_account(current_id) then
    raise exception 'The shared demo account has no activity log';
  end if;

  perform public.record_activity(
    current_id,
    p_event_type,
    'account',
    current_id,
    jsonb_build_object('provider', 'email', 'source', 'client')
  );
end;
$$;

revoke all on function public.record_auth_event(text) from public, anon;
grant execute on function public.record_auth_event(text) to authenticated;

drop trigger if exists notes_log_activity on public.notes;
create trigger notes_log_activity
  after insert or update or delete on public.notes
  for each row execute function public.log_note_activity();

drop trigger if exists profiles_log_activity on public.profiles;
create trigger profiles_log_activity
  after update on public.profiles
  for each row execute function public.log_profile_activity();

-- ----------------------------------------------------------------------------
-- 7) RPCs المشاركة
-- ----------------------------------------------------------------------------

-- إنشاء رابط مشاركة جديد. يُلغي أي رابط نشط سابق لنفس الملاحظة.
-- يعيد الرمز الصريح مرة واحدة فقط.
create or replace function public.create_note_share(p_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid := auth.uid();
  new_token text;
  new_share_id uuid;
  new_expires_at timestamptz;
  revoked_count integer := 0;
begin
  if current_id is null then
    raise exception 'Not authenticated';
  end if;

  if public.is_demo_account(current_id) then
    raise exception 'The shared demo account cannot share notes';
  end if;

  if p_note_id is null or not exists (
    select 1
    from public.notes
    where id = p_note_id
      and user_id = current_id
  ) then
    raise exception 'Note not found';
  end if;

  update public.note_shares
     set revoked_at = now()
   where note_id = p_note_id
     and owner_id = current_id
     and revoked_at is null
     and expires_at > now();
  get diagnostics revoked_count = row_count;

  if revoked_count > 0 then
    perform public.record_activity(
      current_id,
      'share_revoked',
      'note',
      p_note_id,
      jsonb_build_object('reason', 'replaced', 'count', revoked_count)
    );
  end if;

  -- 256 بت من العشوائية: UUIDv4 مرتين = 64 حرفاً ست عشرياً.
  new_token := replace(gen_random_uuid()::text, '-', '')
               || replace(gen_random_uuid()::text, '-', '');
  new_expires_at := now() + interval '7 days';

  insert into public.note_shares (note_id, owner_id, token_hash, expires_at)
  values (
    p_note_id,
    current_id,
    sha256(convert_to(new_token, 'UTF8')),
    new_expires_at
  )
  returning id into new_share_id;

  perform public.record_activity(
    current_id,
    'share_created',
    'note',
    p_note_id,
    jsonb_build_object('share_id', new_share_id, 'expires_at', new_expires_at)
  );

  return jsonb_build_object(
    'share_id', new_share_id,
    'token', new_token,
    'expires_at', new_expires_at
  );
end;
$$;

revoke all on function public.create_note_share(uuid) from public, anon;
grant execute on function public.create_note_share(uuid) to authenticated;

-- إلغاء رابط مشاركة يملكه المستخدم الحالي.
create or replace function public.revoke_note_share(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid := auth.uid();
  target_note_id uuid;
begin
  if current_id is null then
    raise exception 'Not authenticated';
  end if;

  if public.is_demo_account(current_id) then
    raise exception 'The shared demo account cannot manage shares';
  end if;

  update public.note_shares
     set revoked_at = now()
   where id = p_share_id
     and owner_id = current_id
     and revoked_at is null
  returning note_id into target_note_id;

  if target_note_id is null then
    raise exception 'Share not found or already revoked';
  end if;

  perform public.record_activity(
    current_id,
    'share_revoked',
    'note',
    target_note_id,
    jsonb_build_object('reason', 'manual', 'share_id', p_share_id)
  );

  return true;
end;
$$;

revoke all on function public.revoke_note_share(uuid) from public, anon;
grant execute on function public.revoke_note_share(uuid) to authenticated;

-- حالة آخر رابط مشاركة لملاحظة (بدون الرمز أو التجزئة).
create or replace function public.get_note_share_status(p_note_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_id uuid := auth.uid();
  result jsonb;
begin
  if current_id is null then
    raise exception 'Not authenticated';
  end if;

  if public.is_demo_account(current_id) then
    raise exception 'The shared demo account cannot manage shares';
  end if;

  select jsonb_build_object(
    'id', shares.id,
    'created_at', shares.created_at,
    'expires_at', shares.expires_at,
    'is_active', (shares.revoked_at is null and shares.expires_at > now())
  )
  into result
  from public.note_shares as shares
  where shares.note_id = p_note_id
    and shares.owner_id = current_id
    and shares.revoked_at is null
    and shares.expires_at > now()
  order by shares.created_at desc
  limit 1;

  if result is null then
    select jsonb_build_object(
      'id', shares.id,
      'created_at', shares.created_at,
      'expires_at', shares.expires_at,
      'is_active', false
    )
    into result
    from public.note_shares as shares
    where shares.note_id = p_note_id
      and shares.owner_id = current_id
    order by shares.created_at desc
    limit 1;
  end if;

  return result;
end;
$$;

revoke all on function public.get_note_share_status(uuid) from public, anon;
grant execute on function public.get_note_share_status(uuid) to authenticated;

-- قراءة ملاحظة عبر الرمز. متاحة للزوار (anon) وللمسجلين.
-- تعيد null إذا كان الرمز غير صالح أو منتهياً أو ملغياً.
create or replace function public.get_shared_note(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select jsonb_build_object(
    'title', notes.title,
    'content', notes.content,
    'category', notes.category,
    'color', notes.color,
    'created_at', notes.created_at,
    'updated_at', notes.updated_at,
    'owner_name', coalesce(nullif(trim(profiles.name), ''), 'مستخدم'),
    'owner_avatar_color', profiles.avatar_color,
    'expires_at', shares.expires_at,
    'shared_at', shares.created_at
  )
  into result
  from public.note_shares as shares
  join public.notes as notes on notes.id = shares.note_id
  join public.profiles as profiles on profiles.id = shares.owner_id
  where shares.token_hash = sha256(convert_to(p_token, 'UTF8'))
    and shares.revoked_at is null
    and shares.expires_at > now()
    and not public.is_demo_account(shares.owner_id)
  limit 1;

  return result;
end;
$$;

revoke all on function public.get_shared_note(text) from public;
grant execute on function public.get_shared_note(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8) RPC سجل النشاط
-- ----------------------------------------------------------------------------
create or replace function public.list_activity(
  p_limit integer default 50,
  p_before timestamptz default null
)
returns table (
  id bigint,
  event_type text,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_id uuid := auth.uid();
  safe_limit integer;
begin
  if current_id is null then
    raise exception 'Not authenticated';
  end if;

  if public.is_demo_account(current_id) then
    raise exception 'The shared demo account has no activity log';
  end if;

  safe_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  return query
    select
      log.id,
      log.event_type,
      log.entity_type,
      log.entity_id,
      log.metadata,
      log.created_at
    from public.activity_log as log
    where log.user_id = current_id
      and (p_before is null or log.created_at < p_before)
    order by log.created_at desc, log.id desc
    limit safe_limit;
end;
$$;

revoke all on function public.list_activity(integer, timestamptz) from public, anon;
grant execute on function public.list_activity(integer, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 9) إعادة تعيين ملاحظات الحساب التجريبي
--    يستقبل القالب من الواجهة (نفس buildDemoNotes) لتجنب تكرار المحتوى.
--    متاحة للحساب التجريبي فقط، وتستبدل ملاحظاته الحالية بالقالب.
-- ----------------------------------------------------------------------------
create or replace function public.reset_demo_notes(p_notes jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid := auth.uid();
  inserted_count integer := 0;
begin
  if current_id is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_demo_account(current_id) then
    raise exception 'Only the shared demo account can reset demo notes';
  end if;

  if p_notes is null or jsonb_typeof(p_notes) <> 'array' then
    raise exception 'Invalid demo notes payload';
  end if;

  if jsonb_array_length(p_notes) > 50 then
    raise exception 'Too many demo notes';
  end if;

  delete from public.notes where user_id = current_id;

  insert into public.notes (
    id, user_id, title, content, category, color, pinned, favorite, created_at, updated_at
  )
  select
    coalesce(nullif(item ->> 'id', '')::uuid, gen_random_uuid()),
    current_id,
    coalesce(item ->> 'title', ''),
    coalesce(item ->> 'content', ''),
    coalesce(item ->> 'category', 'general'),
    coalesce(item ->> 'color', 'default'),
    coalesce((item ->> 'pinned')::boolean, false),
    coalesce((item ->> 'favorite')::boolean, false),
    coalesce(nullif(item ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(item ->> 'updated_at', '')::timestamptz, now())
  from jsonb_array_elements(p_notes) as item;

  get diagnostics inserted_count = row_count;

  update public.profiles
     set welcome_seeded = true
   where id = current_id;

  return inserted_count;
end;
$$;

revoke all on function public.reset_demo_notes(jsonb) from public, anon;
grant execute on function public.reset_demo_notes(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 10) تحقق داخلي: أي إخفاق يلغي المعاملة بالكامل
-- ----------------------------------------------------------------------------
do $$
begin
  -- الجداول موجودة وRLS مفعّلة.
  if not exists (
    select 1 from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'note_shares'
      and c.relkind = 'r' and c.relrowsecurity
  ) then
    raise exception 'verification failed: note_shares is missing or RLS is disabled';
  end if;

  if not exists (
    select 1 from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'activity_log'
      and c.relkind = 'r' and c.relrowsecurity
  ) then
    raise exception 'verification failed: activity_log is missing or RLS is disabled';
  end if;

  -- لا وصول جدولي مباشر.
  if has_table_privilege('anon', 'public.note_shares', 'select')
     or has_table_privilege('anon', 'public.note_shares', 'insert')
     or has_table_privilege('anon', 'public.note_shares', 'update')
     or has_table_privilege('anon', 'public.note_shares', 'delete') then
    raise exception 'verification failed: anon has direct access to note_shares';
  end if;

  if has_table_privilege('authenticated', 'public.note_shares', 'select')
     or has_table_privilege('authenticated', 'public.note_shares', 'insert')
     or has_table_privilege('authenticated', 'public.note_shares', 'update')
     or has_table_privilege('authenticated', 'public.note_shares', 'delete') then
    raise exception 'verification failed: authenticated has direct access to note_shares';
  end if;

  if has_table_privilege('anon', 'public.activity_log', 'select')
     or has_table_privilege('anon', 'public.activity_log', 'insert')
     or has_table_privilege('anon', 'public.activity_log', 'update')
     or has_table_privilege('anon', 'public.activity_log', 'delete') then
    raise exception 'verification failed: anon has direct access to activity_log';
  end if;

  if has_table_privilege('authenticated', 'public.activity_log', 'select')
     or has_table_privilege('authenticated', 'public.activity_log', 'insert')
     or has_table_privilege('authenticated', 'public.activity_log', 'update')
     or has_table_privilege('authenticated', 'public.activity_log', 'delete') then
    raise exception 'verification failed: authenticated has direct access to activity_log';
  end if;

  if not has_table_privilege('service_role', 'public.note_shares', 'select')
     or not has_table_privilege('service_role', 'public.activity_log', 'select') then
    raise exception 'verification failed: service_role lost access';
  end if;

  -- الرموز: لا عمود صريح، وتجزئة 32 بايت بفهرس فريد.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'note_shares'
      and column_name in ('token', 'plain_token', 'token_plain', 'secret')
  ) then
    raise exception 'verification failed: note_shares exposes a plaintext token column';
  end if;

  if not exists (
    select 1
    from pg_index as index
    join pg_class as table_class on table_class.oid = index.indrelid
    join pg_namespace as table_ns on table_ns.oid = table_class.relnamespace
    where table_ns.nspname = 'public'
      and table_class.relname = 'note_shares'
      and index.indisunique
      and pg_get_indexdef(index.indexrelid) like '%token_hash%'
  ) then
    raise exception 'verification failed: token_hash is not uniquely indexed';
  end if;

  -- الصلاحيات الوظيفية.
  if not has_function_privilege('authenticated', 'public.create_note_share(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.revoke_note_share(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_note_share_status(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.list_activity(integer, timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.reset_demo_notes(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.record_auth_event(text)', 'execute') then
    raise exception 'verification failed: authenticated lost a required RPC';
  end if;

  if has_function_privilege('anon', 'public.create_note_share(uuid)', 'execute')
     or has_function_privilege('anon', 'public.revoke_note_share(uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_note_share_status(uuid)', 'execute')
     or has_function_privilege('anon', 'public.list_activity(integer, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.reset_demo_notes(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.record_auth_event(text)', 'execute') then
    raise exception 'verification failed: anon can execute a restricted RPC';
  end if;

  if not has_function_privilege('anon', 'public.get_shared_note(text)', 'execute') then
    raise exception 'verification failed: anon cannot read shared notes';
  end if;

  -- دوال المشغّلات والمساعدات غير قابلة للاستدعاء من العملاء.
  if has_function_privilege('authenticated', 'public.record_activity(uuid, text, text, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.is_demo_account(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.log_note_activity()', 'execute')
     or has_function_privilege('authenticated', 'public.log_profile_activity()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') then
    raise exception 'verification failed: authenticated can execute an internal function';
  end if;

  -- كل دوال الأمان المعرّفة هنا SECURITY DEFINER مع search_path = ''.
  if exists (
    select 1
    from pg_proc as proc
    join pg_namespace as ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname in (
        'is_demo_account',
        'record_activity',
        'log_note_activity',
        'log_profile_activity',
        'handle_new_user',
        'record_auth_event',
        'create_note_share',
        'revoke_note_share',
        'get_note_share_status',
        'get_shared_note',
        'list_activity',
        'reset_demo_notes'
      )
      and (
        not proc.prosecdef
        or proc.proconfig is null
        or not exists (
          select 1 from unnest(proc.proconfig) as config
          where config = 'search_path=""'
        )
      )
  ) then
    raise exception 'verification failed: a security definer function lacks search_path = ''''';
  end if;

  -- get_shared_note لا يعيد البريد الإلكتروني.
  if position('email' in lower(pg_get_functiondef('public.get_shared_note(text)'::regprocedure))) > 0 then
    raise exception 'verification failed: get_shared_note references email';
  end if;

  -- قيد أنواع الأحداث موجود.
  if not exists (
    select 1 from pg_constraint
    where conname = 'activity_log_event_type_check'
      and conrelid = 'public.activity_log'::regclass
  ) then
    raise exception 'verification failed: activity_log event type constraint is missing';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
