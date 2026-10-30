-- ============================================================================
--  ملاحظات هامة — فحص سريع لمخطط Supabase
--  نفّذ هذا الاستعلام من نفس مشروع Supabase (SQL Editor) وأرسل النتيجة.
--  الاستعلام للقراءة فقط ولا يعدّل أي بيانات.
-- ============================================================================

select jsonb_pretty(
  jsonb_build_object(
    'database', current_database(),
    'tables', (
      select jsonb_agg(jsonb_build_object('name', tablename, 'rls_enabled', rowsecurity))
      from pg_tables
      where schemaname = 'public' and tablename in ('profiles', 'notes')
    ),
    'policies', (
      select jsonb_agg(jsonb_build_object(
        'table', tablename,
        'name', policyname,
        'command', cmd,
        'roles', roles
      ))
      from pg_policies
      where schemaname = 'public' and tablename in ('profiles', 'notes')
    ),
    'functions', (
      select jsonb_agg(p.proname order by p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('delete_own_account', 'handle_new_user', 'protect_demo_account', 'set_updated_at')
    ),
    'triggers', (
      select jsonb_agg(tgname order by tgname)
      from pg_trigger
      where not tgisinternal
        and tgname in ('on_auth_user_created', 'protect_demo_account', 'profiles_set_updated_at', 'notes_set_updated_at')
    ),
    'grants', (
      select jsonb_agg(jsonb_build_object(
        'table', table_name,
        'grantee', grantee,
        'privilege', privilege_type
      ) order by table_name, grantee, privilege_type)
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('profiles', 'notes')
        and grantee in ('anon', 'authenticated')
    ),
    'demo_user_count', (
      select count(*) from auth.users where lower(email) = 'demo@notes.app'
    ),
    'demo_profile', (
      select to_jsonb(profiles)
      from public.profiles as profiles
      join auth.users as users on users.id = profiles.id
      where lower(users.email) = 'demo@notes.app'
    ),
    'demo_notes_count', (
      select count(*)
      from public.notes as notes
      join auth.users as users on users.id = notes.user_id
      where lower(users.email) = 'demo@notes.app'
    )
  )
) as diagnostic;
