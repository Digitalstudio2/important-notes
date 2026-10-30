-- ============================================================================
--  verify_hardening.sql
--  فحص للقراءة فقط بعد تطبيق 001_harden_privileges.sql
--  لا يعدّل أي بيانات أو صلاحيات.
--
--  الاستخدام:
--    psql "$CONNECTION_STRING" -v ON_ERROR_STOP=1 -f supabase/verify_hardening.sql
-- ============================================================================

select jsonb_pretty(
  jsonb_build_object(
    'database', current_database(),
    'checked_at', now(),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'name', c.relname,
        'rls_enabled', c.relrowsecurity,
        'owner', pg_get_userbyid(c.relowner),
        'acl', c.relacl::text
      ) order by c.relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    ),
    'policies', (
      select jsonb_agg(jsonb_build_object(
        'table', tablename,
        'name', policyname,
        'command', cmd,
        'roles', roles
      ) order by tablename, policyname)
      from pg_policies
      where schemaname = 'public'
    ),
    'functions', (
      select jsonb_agg(jsonb_build_object(
        'name', p.proname,
        'args', pg_get_function_identity_arguments(p.oid),
        'security_definer', p.prosecdef,
        'config', p.proconfig::text,
        'acl', p.proacl::text
      ) order by p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    ),
    'privilege_matrix', jsonb_build_object(
      'anon_notes_select', has_table_privilege('anon', 'public.notes', 'select'),
      'anon_notes_insert', has_table_privilege('anon', 'public.notes', 'insert'),
      'anon_profiles_select', has_table_privilege('anon', 'public.profiles', 'select'),
      'anon_delete_own_account', has_function_privilege('anon', 'public.delete_own_account()', 'execute'),
      'anon_handle_new_user', has_function_privilege('anon', 'public.handle_new_user()', 'execute'),
      'authenticated_notes_select', has_table_privilege('authenticated', 'public.notes', 'select'),
      'authenticated_notes_insert', has_table_privilege('authenticated', 'public.notes', 'insert'),
      'authenticated_notes_update', has_table_privilege('authenticated', 'public.notes', 'update'),
      'authenticated_notes_delete', has_table_privilege('authenticated', 'public.notes', 'delete'),
      'authenticated_profiles_select', has_table_privilege('authenticated', 'public.profiles', 'select'),
      'authenticated_profiles_insert', has_table_privilege('authenticated', 'public.profiles', 'insert'),
      'authenticated_profiles_update', has_table_privilege('authenticated', 'public.profiles', 'update'),
      'authenticated_profiles_delete', has_table_privilege('authenticated', 'public.profiles', 'delete'),
      'authenticated_delete_own_account', has_function_privilege('authenticated', 'public.delete_own_account()', 'execute'),
      'authenticated_handle_new_user', has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
      'authenticated_protect_demo_account', has_function_privilege('authenticated', 'public.protect_demo_account()', 'execute'),
      'authenticated_set_updated_at', has_function_privilege('authenticated', 'public.set_updated_at()', 'execute'),
      'service_role_notes_select', has_table_privilege('service_role', 'public.notes', 'select'),
      'service_role_profiles_select', has_table_privilege('service_role', 'public.profiles', 'select')
    ),
    'default_privileges', (
      select jsonb_agg(jsonb_build_object(
        'role', pg_get_userbyid(d.defaclrole),
        'schema', case when d.defaclnamespace = 0 then '(global)' else d.defaclnamespace::regnamespace::text end,
        'object_type', d.defaclobjtype,
        'acl', d.defaclacl::text
      ) order by 2, 1, 3)
      from pg_default_acl d
    ),
    'schema_public', (
      select jsonb_build_object(
        'owner', pg_get_userbyid(n.nspowner),
        'acl', n.nspacl::text
      )
      from pg_namespace n
      where n.nspname = 'public'
    ),
    'counts', jsonb_build_object(
      'profiles', (select count(*) from public.profiles),
      'notes', (select count(*) from public.notes),
      'auth_users', (select count(*) from auth.users),
      'auth_identities', (select count(*) from auth.identities),
      'demo_notes', (
        select count(*)
        from public.notes as notes
        join auth.users as users on users.id = notes.user_id
        where lower(users.email) = 'demo@notes.app'
      )
    )
  )
) as hardening_report;
