-- ============================================================================
--  001_harden_privileges.sql
--  المرحلة 0: تحصين صلاحيات مخطط public
--
--  الهدف:
--   - دور anon لا يملك أي صلاحية على الجداول أو التسلسلات أو الدوال.
--   - دور authenticated يحصل على الحد الأدنى الذي يستخدمه التطبيق فقط.
--   - دوال المشغّلات (trigger functions) غير قابلة للاستدعاء المباشر.
--   - الكائنات المستقبلية التي ينشئها postgres تكون deny-by-default.
--   - دوال SECURITY DEFINER تحتفظ بـ search_path = ''.
--
--  طريقة التطبيق:
--   psql "$CONNECTION_STRING" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/001_harden_privileges.sql
--
--  ملاحظات مهمة:
--   - لا يحذف هذا الملف أي جدول أو عمود أو بيانات.
--   - يعمل داخل معاملة واحدة؛ أي فشل في التحقق يتراجع عن كل التغييرات.
--   - لا يعدّل الامتيازات الافتراضية لدور supabase_admin لأن postgres
--     ليس عضواً فيه وليس superuser. راجع README للمخاطرة المتبقية.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) الكائنات الحالية: إزالة الصلاحيات الواسعة أو المجهولة
-- ----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
revoke all on all functions in schema public from authenticated;

-- دفاع إضافي: لا تنفيذ عام (PUBLIC) لأي دالة حالية في public.
revoke all on all functions in schema public from public;

-- ----------------------------------------------------------------------------
-- 2) إعادة منح الحد الأدنى الذي يستخدمه التطبيق فعلياً
-- ----------------------------------------------------------------------------
-- ملاحظة: USAGE على مخطط public ممنوح مسبقاً لـ anon/authenticated في
-- الإنتاج، ولا نعيد منحه هنا لأن postgres ليس مالك المخطط
-- (المالك هو pg_database_owner). لا نمنح CREATE لأي منهما.

grant select, insert, update, delete on table public.notes to authenticated;
grant select, insert, update on table public.profiles to authenticated;

-- دالة RPC الوحيدة التي يستدعيها التطبيق.
grant execute on function public.delete_own_account() to authenticated;

-- دوال المشغّلات يجب ألا تكون قابلة للاستدعاء المباشر من عملاء API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.protect_demo_account() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- delete_own_account ليست دالة مشغّل: authenticated فقط هي التي تستدعيها.
revoke all on function public.delete_own_account() from public, anon;

-- ----------------------------------------------------------------------------
-- 3) الكائنات المستقبلية التي ينشئها postgres: deny-by-default
-- ----------------------------------------------------------------------------
-- يجب تعديل الامتيازات الافتراضية العامة (global) أيضاً، لأن REVOKE
-- على مستوى المخطط لا يستطيع إزالة صلاحية ممنوحة افتراضياً على المستوى
-- العام (خصوصاً EXECUTE على الدوال لـ PUBLIC).
alter default privileges for role postgres
  revoke all on tables from anon;
alter default privileges for role postgres
  revoke all on tables from authenticated;
alter default privileges for role postgres
  revoke all on sequences from anon;
alter default privileges for role postgres
  revoke all on sequences from authenticated;
alter default privileges for role postgres
  revoke all on functions from anon;
alter default privileges for role postgres
  revoke all on functions from authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;

-- مواءمة الامتيازات الافتراضية على مستوى مخطط public أيضاً (واضحة وقابلة للتدقيق).
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon;
alter default privileges for role postgres in schema public
  revoke all on functions from authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- ----------------------------------------------------------------------------
-- 4) تحقق داخلي: أي إخفاق يلغي المعاملة بالكامل
-- ----------------------------------------------------------------------------
do $$
begin
  -- anon: لا وصول جدولي أو وظيفي.
  if has_table_privilege('anon', 'public.notes', 'select')
     or has_table_privilege('anon', 'public.notes', 'insert')
     or has_table_privilege('anon', 'public.notes', 'update')
     or has_table_privilege('anon', 'public.notes', 'delete') then
    raise exception 'hardening check failed: anon still has access to public.notes';
  end if;

  if has_table_privilege('anon', 'public.profiles', 'select')
     or has_table_privilege('anon', 'public.profiles', 'insert')
     or has_table_privilege('anon', 'public.profiles', 'update')
     or has_table_privilege('anon', 'public.profiles', 'delete') then
    raise exception 'hardening check failed: anon still has access to public.profiles';
  end if;

  if has_function_privilege('anon', 'public.delete_own_account()', 'execute')
     or has_function_privilege('anon', 'public.handle_new_user()', 'execute')
     or has_function_privilege('anon', 'public.protect_demo_account()', 'execute')
     or has_function_privilege('anon', 'public.set_updated_at()', 'execute') then
    raise exception 'hardening check failed: anon can still execute a public function';
  end if;

  -- authenticated: CRUD على الملاحظات، وselect/insert/update على الملف الشخصي.
  if not has_table_privilege('authenticated', 'public.notes', 'select')
     or not has_table_privilege('authenticated', 'public.notes', 'insert')
     or not has_table_privilege('authenticated', 'public.notes', 'update')
     or not has_table_privilege('authenticated', 'public.notes', 'delete') then
    raise exception 'hardening check failed: authenticated lost required notes privileges';
  end if;

  if not has_table_privilege('authenticated', 'public.profiles', 'select')
     or not has_table_privilege('authenticated', 'public.profiles', 'insert')
     or not has_table_privilege('authenticated', 'public.profiles', 'update') then
    raise exception 'hardening check failed: authenticated lost required profiles privileges';
  end if;

  if has_table_privilege('authenticated', 'public.profiles', 'delete') then
    raise exception 'hardening check failed: authenticated can still delete profiles directly';
  end if;

  -- authenticated: RPC واحدة فقط، ولا تنفيذ لدوال المشغّلات.
  if not has_function_privilege('authenticated', 'public.delete_own_account()', 'execute') then
    raise exception 'hardening check failed: authenticated lost delete_own_account RPC';
  end if;

  if has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'public.protect_demo_account()', 'execute')
     or has_function_privilege('authenticated', 'public.set_updated_at()', 'execute') then
    raise exception 'hardening check failed: authenticated can still execute a trigger function';
  end if;

  -- service_role: يبقى قادراً على إدارة البيانات (PostgREST admin).
  if not has_table_privilege('service_role', 'public.notes', 'select')
     or not has_table_privilege('service_role', 'public.profiles', 'select') then
    raise exception 'hardening check failed: service_role lost required access';
  end if;
end
$$;

commit;
