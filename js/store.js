/* ==========================================================================
   مساحة التدوين — Supabase data layer
   --------------------------------------------------------------------------
   - Auth: Supabase Auth (email + password, optional anonymous demo user).
   - Data: public.profiles + public.notes protected by Row Level Security.
   - The browser only ever receives the publishable key.
   ========================================================================== */
(function () {
  'use strict';

  var SUPABASE_URL = window.HN_SUPABASE_URL;
  var SUPABASE_KEY = window.HN_SUPABASE_PUBLISHABLE_KEY;

  var AUTH_STORAGE_KEY = 'hn.auth.session.v1';
  var REMEMBER_KEY = 'hn.remember.v1';

  var CATEGORIES = [
    { id: 'work', name: 'عمل', color: '#6366f1' },
    { id: 'personal', name: 'شخصي', color: '#0f9f6b' },
    { id: 'study', name: 'دراسة', color: '#e11d48' },
    { id: 'ideas', name: 'أفكار', color: '#d97706' },
    { id: 'tasks', name: 'مهام', color: '#0284c7' },
    { id: 'general', name: 'عام', color: '#64748b' }
  ];

  var NOTE_COLORS = ['default', 'sand', 'mint', 'sky', 'rose', 'violet'];
  var AVATAR_COLORS = ['emerald', 'indigo', 'rose', 'amber', 'sky', 'violet'];
  var THEMES = ['light', 'dark', 'system'];
  var LAYOUTS = ['grid', 'list'];
  var SORTS = ['updated-desc', 'updated-asc', 'created-desc', 'title-asc'];

  var DEMO = {
    email: 'demo@notes.app',
    password: 'Demo@1234',
    name: 'سارة العتيبي'
  };

  var client = null;
  var currentUser = null;
  var notesQueue = Promise.resolve();
  var prefsQueue = Promise.resolve();

  /* ---------- Errors ---------- */
  function makeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function logError(scope, error) {
    if (window.console && typeof window.console.error === 'function') {
      window.console.error('[Supabase ' + scope + ']', error);
    }
  }

  function dbError(error) {
    logError('db', error);
    var message = String((error && (error.message || error.details || error.hint)) || '');
    var code = String((error && error.code) || '');

    if (code === 'PGRST205' || code === 'PGRST202' || /schema cache|does not exist|could not find the table|could not find the .*function/i.test(message)) {
      return makeError('schema-missing', 'لم يتم إعداد جداول قاعدة البيانات بعد. نفّذ ملف supabase/schema.sql في لوحة Supabase ثم حاول مرة أخرى.');
    }
    if (code === '42501' || /row-level security|permission denied/i.test(message)) {
      return makeError('permission', 'ليس لديك صلاحية للوصول إلى هذه البيانات.');
    }
    if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(message)) {
      return makeError('network', 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.');
    }
    if (code === '23505' || /duplicate key/i.test(message)) {
      return makeError('duplicate', 'هذا العنصر محفوظ مسبقاً.');
    }
    if (code === '23514' || /violates check constraint/i.test(message)) {
      return makeError('invalid-data', 'بعض قيم الملاحظة غير صالحة. حدّث الصفحة وحاول مرة أخرى.');
    }
    if (/demo account/i.test(message)) {
      return makeError('demo-restricted', 'هذا حساب تجريبي مشترك، ولا يمكن استخدام هذه الميزة فيه.');
    }
    if (/note not found/i.test(message)) {
      return makeError('not-found', 'الملاحظة غير موجودة أو لا تملك صلاحية الوصول إليها.');
    }
    if (/share not found/i.test(message)) {
      return makeError('not-found', 'رابط المشاركة غير موجود أو تم إلغاؤه مسبقاً.');
    }
    if (/not authenticated/i.test(message)) {
      return makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.');
    }
    return makeError('db', 'تعذّر إتمام العملية على قاعدة البيانات. حاول مرة أخرى.');
  }

  function authError(error) {
    logError('auth', error);
    var message = String((error && (error.message || error.error_description)) || '');
    var code = String((error && error.code) || '');

    if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
      return makeError('invalid-credentials', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
      return makeError('email-not-confirmed', 'يرجى تأكيد بريدك الإلكتروني أولاً. تحقق من صندوق الوارد ثم سجّل الدخول.');
    }
    if (code === 'user_already_exists' || /user already registered|already been registered/i.test(message)) {
      return makeError('email-exists', 'هذا البريد الإلكتروني مسجّل مسبقاً. سجّل الدخول بدلاً من ذلك.');
    }
    if (code === 'weak_password' || /password should be at least/i.test(message)) {
      return makeError('weak-password', 'كلمة المرور قصيرة جداً. استخدم 8 أحرف على الأقل.');
    }
    if (code === 'email_address_invalid' || code === 'invalid_email' || /invalid email|email address .*invalid/i.test(message)) {
      return makeError('invalid-email', 'البريد الإلكتروني غير صالح.');
    }
    if (code === 'signup_disabled' || /signups not allowed/i.test(message)) {
      return makeError('signup-disabled', 'إنشاء الحسابات الجديدة غير مفعّل حالياً.');
    }
    if (code === 'over_email_send_rate_limit' || /email rate limit|for security purposes/i.test(message)) {
      return makeError('rate-limit', 'تم إرسال عدد كبير من الرسائل. انتظر قليلاً ثم حاول مرة أخرى.');
    }
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
      return makeError('network', 'تعذّر الاتصال بخادم المصادقة. تحقق من اتصالك بالإنترنت.');
    }
    return makeError('auth', 'تعذّر إتمام عملية المصادقة. حاول مرة أخرى.');
  }

  function errorMessage(error) {
    if (error && typeof error.message === 'string' && error.message) return error.message;
    return 'تعذّر إتمام العملية. حاول مرة أخرى.';
  }

  function assertNotDemo(action) {
    if (currentUser && currentUser.isDemo) {
      throw makeError('demo-restricted', 'هذا حساب تجريبي مشترك، ولا يمكن ' + action + '.');
    }
  }

  /* ---------- Auth storage (remember me) ---------- */
  function getRemember() {
    try {
      return localStorage.getItem(REMEMBER_KEY) !== '0';
    } catch (error) {
      return true;
    }
  }

  function setRemember(remember) {
    try {
      localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
    } catch (error) {}
  }

  function clearAuthStorage() {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (error) {}
    try { sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch (error) {}
  }

  var authStorage = {
    getItem: function (key) {
      try {
        var local = localStorage.getItem(key);
        if (local !== null) return local;
      } catch (error) {}
      try {
        return sessionStorage.getItem(key);
      } catch (error) {
        return null;
      }
    },
    setItem: function (key, value) {
      try {
        if (getRemember()) {
          localStorage.setItem(key, value);
          try { sessionStorage.removeItem(key); } catch (error) {}
        } else {
          sessionStorage.setItem(key, value);
          try { localStorage.removeItem(key); } catch (error) {}
        }
      } catch (error) {
        logError('storage', error);
      }
    },
    removeItem: function (key) {
      try { localStorage.removeItem(key); } catch (error) {}
      try { sessionStorage.removeItem(key); } catch (error) {}
    }
  };

  /* ---------- Client ---------- */
  function createClient() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;

    try {
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          storage: authStorage,
          storageKey: AUTH_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: 'pkce'
        },
        global: {
          headers: { 'x-application-name': 'important-notes' }
        }
      });
    } catch (error) {
      logError('init', error);
      return null;
    }
  }

  function requireClient() {
    if (!client) {
      throw makeError('not-configured', 'تعذّر الاتصال بخدمة Supabase. تحقق من اتصالك بالإنترنت ثم أعد تحميل الصفحة.');
    }
    return client;
  }

  /* ---------- Helpers ---------- */
  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (character) {
      var random = Math.random() * 16 | 0;
      var value = character === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function randomAvatarColor() {
    return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  }

  function parseDate(value) {
    var time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  function validCategory(value) {
    return CATEGORIES.some(function (category) { return category.id === value; }) ? value : 'general';
  }

  function validColor(value) {
    return NOTE_COLORS.indexOf(value) !== -1 ? value : 'default';
  }

  function validTheme(value) {
    return THEMES.indexOf(value) !== -1 ? value : 'system';
  }

  function validSort(value) {
    return SORTS.indexOf(value) !== -1 ? value : 'updated-desc';
  }

  function fallbackName(authUser) {
    var metadata = (authUser && authUser.user_metadata) || {};
    var name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
    if (!name && authUser && authUser.email) name = String(authUser.email).split('@')[0];
    return (name || 'مستخدم').slice(0, 60);
  }

  /* ---------- Mapping ---------- */
  function mapUser(authUser, profile) {
    profile = profile || {};
    return {
      id: authUser.id,
      name: profile.name || fallbackName(authUser),
      email: authUser.email || '',
      avatarColor: AVATAR_COLORS.indexOf(profile.avatar_color) !== -1 ? profile.avatar_color : 'emerald',
      createdAt: parseDate(profile.created_at) || parseDate(authUser.created_at) || Date.now(),
      updatedAt: parseDate(profile.updated_at) || Date.now(),
      isDemo: !!authUser.is_anonymous || String(authUser.email || '').toLowerCase() === DEMO.email,
      welcomeSeeded: profile.welcome_seeded === true,
      prefs: {
        theme: validTheme(profile.theme),
        layout: profile.layout === 'list' ? 'list' : 'grid',
        sort: validSort(profile.sort)
      }
    };
  }

  function mapNote(row) {
    return {
      id: row.id,
      title: row.title || '',
      content: row.content || '',
      category: validCategory(row.category),
      color: validColor(row.color),
      pinned: row.pinned === true,
      favorite: row.favorite === true,
      createdAt: parseDate(row.created_at) || Date.now(),
      updatedAt: parseDate(row.updated_at) || Date.now()
    };
  }

  function notePayload(note) {
    return {
      title: String(note.title || '').trim().slice(0, 160),
      content: String(note.content || '').slice(0, 20000),
      category: validCategory(note.category),
      color: validColor(note.color),
      pinned: note.pinned === true,
      favorite: note.favorite === true
    };
  }

  function mapShareStatus(row) {
    if (!row) return null;
    return {
      id: row.id || '',
      createdAt: parseDate(row.created_at),
      expiresAt: parseDate(row.expires_at),
      isActive: row.is_active === true
    };
  }

  function mapSharedNote(row) {
    if (!row) return null;
    return {
      title: row.title || '',
      content: row.content || '',
      category: validCategory(row.category),
      color: validColor(row.color),
      createdAt: parseDate(row.created_at),
      updatedAt: parseDate(row.updated_at),
      ownerName: row.owner_name || 'مستخدم',
      ownerAvatarColor: AVATAR_COLORS.indexOf(row.owner_avatar_color) !== -1 ? row.owner_avatar_color : 'emerald',
      expiresAt: parseDate(row.expires_at),
      sharedAt: parseDate(row.shared_at)
    };
  }

  function mapActivity(row) {
    return {
      id: Number(row.id) || 0,
      eventType: row.event_type || '',
      entityType: row.entity_type || '',
      entityId: row.entity_id || '',
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      createdAt: parseDate(row.created_at)
    };
  }

  function noteRow(note, userId) {
    var payload = notePayload(note);
    payload.id = note.id;
    payload.user_id = userId;
    payload.created_at = new Date(Number(note.createdAt) || Date.now()).toISOString();
    payload.updated_at = new Date(Number(note.updatedAt) || Date.now()).toISOString();
    return payload;
  }

  function sameNote(first, second) {
    return first.title === second.title &&
      first.content === second.content &&
      first.category === second.category &&
      first.color === second.color &&
      !!first.pinned === !!second.pinned &&
      !!first.favorite === !!second.favorite;
  }

  /* ---------- Profiles ---------- */
  async function createFallbackProfile(authUser) {
    var { data, error } = await requireClient()
      .from('profiles')
      .upsert({
        id: authUser.id,
        name: fallbackName(authUser),
        avatar_color: randomAvatarColor()
      }, { onConflict: 'id' })
      .select('*')
      .single();

    if (error && (error.code === '23505' || /duplicate key/i.test(String(error.message || '')))) {
      var { data: existing, error: readError } = await requireClient()
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();
      if (!readError && existing) return existing;
    }

    if (error) throw dbError(error);
    return data;
  }

  async function getProfile(authUser) {
    var { data, error } = await requireClient()
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (error) throw dbError(error);
    if (data) return data;
    return createFallbackProfile(authUser);
  }

  async function fetchCurrentUser(authUser) {
    var profile = await getProfile(authUser);
    var user = mapUser(authUser, profile);
    currentUser = user;
    return user;
  }

  async function ensureWelcomeNote(user) {
    if (!user || user.welcomeSeeded || user.isDemo) return;

    var { count, error } = await requireClient()
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (error) throw dbError(error);

    if (!count) {
      var { error: insertError } = await requireClient()
        .from('notes')
        .insert([noteRow(makeWelcomeNote(user.name), user.id)]);
      if (insertError) throw dbError(insertError);
    }

    var { error: profileError } = await requireClient()
      .from('profiles')
      .update({ welcome_seeded: true })
      .eq('id', user.id);
    if (profileError) throw dbError(profileError);

    user.welcomeSeeded = true;
  }

  /* ---------- Auth ---------- */
  function init() {
    client = createClient();
    return !!client;
  }

  function isConfigured() {
    return !!client;
  }

  async function restoreSession() {
    if (!client) return null;

    var { data, error } = await client.auth.getSession();
    if (error) throw authError(error);
    if (!data || !data.session || !data.session.user) return null;

    var user = await fetchCurrentUser(data.session.user);
    await ensureWelcomeNote(user);
    await ensureDemoNotes(user);
    return user;
  }

  async function signIn(email, password, remember) {
    var activeClient = requireClient();
    var normalized = normalizeEmail(email);

    setRemember(remember !== false);
    if (remember === false) {
      try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (error) {}
    } else {
      try { sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch (error) {}
    }

    var { data, error } = await activeClient.auth.signInWithPassword({
      email: normalized,
      password: String(password || '')
    });

    if (error) throw authError(error);
    if (!data || !data.user) {
      throw makeError('invalid-credentials', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }

    var user = await fetchCurrentUser(data.user);
    if (user.isDemo) {
      await prepareDemoSession(user);
    } else {
      await ensureWelcomeNote(user);
      await recordAuthEvent('login');
    }
    return user;
  }

  async function signUp(options) {
    var activeClient = requireClient();
    var name = String(options.name || '').trim();
    var email = normalizeEmail(options.email);
    var password = String(options.password || '');

    setRemember(true);

    var { data, error } = await activeClient.auth.signUp({
      email: email,
      password: password,
      options: { data: { name: name } }
    });

    if (error) throw authError(error);
    if (!data || !data.user) {
      throw makeError('auth', 'تعذّر إنشاء الحساب. حاول مرة أخرى.');
    }

    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw makeError('email-exists', 'هذا البريد الإلكتروني مسجّل مسبقاً. سجّل الدخول بدلاً من ذلك.');
    }

    if (!data.session) {
      return { user: null, needsConfirmation: true };
    }

    var user = await fetchCurrentUser(data.user);

    if (options.prefs) {
      try { await savePrefs(options.prefs); } catch (prefsError) {}
    }

    await ensureWelcomeNote(user);
    return { user: user, needsConfirmation: false };
  }

  async function ensureDemoNotes(user) {
    if (!user || !user.isDemo || user.welcomeSeeded) return;

    var activeClient = requireClient();

    var { count, error: countError } = await activeClient
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (countError) throw dbError(countError);

    if (!count) {
      var rows = buildDemoNotes().map(function (note) { return noteRow(note, user.id); });
      var { error: insertError } = await activeClient.from('notes').insert(rows);
      if (insertError) throw dbError(insertError);
    }

    var { error: profileError } = await activeClient
      .from('profiles')
      .update({ welcome_seeded: true })
      .eq('id', user.id);
    if (profileError) throw dbError(profileError);

    user.welcomeSeeded = true;
  }

  async function prepareDemoSession(user) {
    try {
      await resetDemoNotes();
    } catch (error) {
      logError('demo-reset', error);
      user.welcomeSeeded = false;
      try {
        await ensureDemoNotes(user);
      } catch (seedError) {
        logError('demo-seed', seedError);
      }
    }
  }

  async function signInDemo() {
    var activeClient = requireClient();

    setRemember(true);
    try { sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch (error) {}

    var { data, error } = await activeClient.auth.signInWithPassword({
      email: DEMO.email,
      password: DEMO.password
    });

    if (error) {
      if (String(error.code || '') === 'invalid_credentials' || /invalid login credentials/i.test(String(error.message || ''))) {
        throw makeError('demo-unavailable', 'الحساب التجريبي غير مهيّأ بعد. أنشئ المستخدم demo@notes.app في لوحة Supabase ثم حاول مرة أخرى.');
      }
      throw authError(error);
    }
    if (!data || !data.user) {
      throw makeError('demo-unavailable', 'تعذّر فتح الحساب التجريبي حالياً.');
    }

    var user = await fetchCurrentUser(data.user);
    await prepareDemoSession(user);
    return user;
  }

  async function signOut() {
    if (client) {
      try {
        await client.auth.signOut();
      } catch (error) {
        logError('signout', error);
      }
    }
    currentUser = null;
    clearAuthStorage();
  }

  async function updateProfile(changes) {
    if (!currentUser) throw makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.');

    var payload = {};

    if (typeof changes.name === 'string') {
      var name = changes.name.trim();
      if (name.length < 2) throw makeError('invalid-name', 'يرجى إدخال اسم صحيح.');
      payload.name = name.slice(0, 60);
    }

    if (typeof changes.avatarColor === 'string' && AVATAR_COLORS.indexOf(changes.avatarColor) !== -1) {
      payload.avatar_color = changes.avatarColor;
    }

    if (!Object.keys(payload).length) return currentUser;

    var { data, error } = await requireClient()
      .from('profiles')
      .update(payload)
      .eq('id', currentUser.id)
      .select('*')
      .single();

    if (error) throw dbError(error);

    var updated = mapUser({
      id: currentUser.id,
      email: currentUser.email,
      created_at: new Date(currentUser.createdAt).toISOString()
    }, data);

    currentUser = updated;
    return updated;
  }

  async function changePassword(currentPassword, newPassword) {
    var activeClient = requireClient();
    if (!currentUser) throw makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.');
    assertNotDemo('تغيير كلمة مروره');
    if (!currentUser.email) throw makeError('auth', 'تعذّر التحقق من البريد الإلكتروني للحساب.');
    if (!newPassword || newPassword.length < 8) {
      throw makeError('weak-password', 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.');
    }

    var { error: verifyError } = await activeClient.auth.signInWithPassword({
      email: currentUser.email,
      password: String(currentPassword || '')
    });

    if (verifyError) {
      if (String(verifyError.code || '') === 'invalid_credentials' || /invalid login credentials/i.test(String(verifyError.message || ''))) {
        throw makeError('wrong-password', 'كلمة المرور الحالية غير صحيحة.');
      }
      throw authError(verifyError);
    }

    var { error } = await activeClient.auth.updateUser({ password: newPassword });
    if (error) throw authError(error);

    await recordAuthEvent('password_changed');

    return true;
  }

  async function deleteAccount() {
    if (!currentUser) throw makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.');
    assertNotDemo('حذفه');

    var { error } = await requireClient().rpc('delete_own_account');
    if (error) throw dbError(error);

    if (client) {
      try { await client.auth.signOut({ scope: 'local' }); } catch (signOutError) {}
    }
    currentUser = null;
    clearAuthStorage();
  }

  /* ---------- Preferences ---------- */
  function savePrefs(prefs) {
    if (!client || !currentUser) return Promise.resolve();

    var userId = currentUser.id;
    var payload = {
      theme: validTheme(prefs && prefs.theme),
      layout: prefs && prefs.layout === 'list' ? 'list' : 'grid',
      sort: validSort(prefs && prefs.sort)
    };

    function run() {
      return client
        .from('profiles')
        .update(payload)
        .eq('id', userId)
        .then(function (result) {
          if (result.error) throw dbError(result.error);
          return true;
        });
    }

    prefsQueue = prefsQueue.then(run, run);
    return prefsQueue;
  }

  /* ---------- Notes ---------- */
  async function getNotes() {
    var activeClient = requireClient();
    if (!currentUser) return [];

    var { data, error } = await activeClient
      .from('notes')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false });

    if (error) throw dbError(error);
    return (data || []).map(mapNote);
  }

  async function insertNoteRows(rows) {
    var chunkSize = 100;
    for (var index = 0; index < rows.length; index += chunkSize) {
      var { error } = await requireClient().from('notes').insert(rows.slice(index, index + chunkSize));
      if (error) throw dbError(error);
    }
  }

  async function deleteNoteRows(ids, userId) {
    var chunkSize = 100;
    for (var index = 0; index < ids.length; index += chunkSize) {
      var { error } = await requireClient()
        .from('notes')
        .delete()
        .in('id', ids.slice(index, index + chunkSize))
        .eq('user_id', userId);
      if (error) throw dbError(error);
    }
  }

  async function doSaveNotes(userId, previous, next) {
    var previousById = {};
    previous.forEach(function (note) { previousById[note.id] = note; });

    var nextById = {};
    next.forEach(function (note) { nextById[note.id] = note; });

    var added = next.filter(function (note) { return !previousById[note.id]; });
    var removed = previous.filter(function (note) { return !nextById[note.id]; }).map(function (note) { return note.id; });
    var changed = next.filter(function (note) {
      var old = previousById[note.id];
      return old && !sameNote(old, note);
    });

    var tasks = [];

    if (added.length) {
      tasks.push(insertNoteRows(added.map(function (note) { return noteRow(note, userId); })));
    }

    if (removed.length) {
      if (!next.length) {
        tasks.push(requireClient().from('notes').delete().eq('user_id', userId).then(function (result) {
          if (result.error) throw dbError(result.error);
        }));
      } else {
        tasks.push(deleteNoteRows(removed, userId));
      }
    }

    changed.forEach(function (note) {
      tasks.push(requireClient()
        .from('notes')
        .update(notePayload(note))
        .eq('id', note.id)
        .eq('user_id', userId)
        .then(function (result) {
          if (result.error) throw dbError(result.error);
        }));
    });

    await Promise.all(tasks);
  }

  function saveNotes(previous, next) {
    if (!currentUser) {
      return Promise.reject(makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.'));
    }

    var userId = currentUser.id;
    var list = Array.isArray(previous) ? previous : [];
    var target = Array.isArray(next) ? next : [];

    function run() {
      return doSaveNotes(userId, list, target);
    }

    notesQueue = notesQueue.then(run, run);
    return notesQueue;
  }

  function makeNote(data) {
    var now = Date.now();
    return {
      id: uid(),
      title: String(data.title || '').trim().slice(0, 160),
      content: String(data.content || '').slice(0, 20000),
      category: validCategory(data.category),
      color: validColor(data.color),
      pinned: data.pinned === true,
      favorite: data.favorite === true,
      createdAt: Number(data.createdAt) || now,
      updatedAt: Number(data.updatedAt) || now
    };
  }

  function makeWelcomeNote(name) {
    var firstName = String(name || '').trim().split(/\s+/)[0] || '';
    var greeting = firstName ? 'أهلاً بك، ' + firstName + ' 👋' : 'أهلاً بك 👋';
    return makeNote({
      title: 'مساحتك الخاصة جاهزة',
      content: greeting + '\n\nهذه مساحتك الشخصية لتدوين كل ما يهمك، محفوظة بأمان في حسابك. إليك بعض النصائح السريعة:\n\n• استخدم زر «ملاحظة جديدة» لتدوين فكرة في أي وقت.\n• ثبّت الملاحظات المهمة لتظهر في أعلى القائمة.\n• أضف ما تعود إليه كثيراً إلى المفضلة.\n• نظّم أفكارك عبر التصنيفات الملوّنة.\n• ابحث بسرعة بالضغط على Ctrl + K.\n\nملاحظاتك محفوظة في حسابك الخاص، ولا يستطيع أي مستخدم آخر الوصول إليها.',
      category: 'general',
      color: 'mint',
      pinned: true,
      favorite: true
    });
  }

  function buildDemoNotes() {
    var now = Date.now();
    var hour = 60 * 60 * 1000;
    var day = 24 * hour;
    return [
      makeNote({
        title: 'خطة إطلاق المنتج — الربع الرابع',
        content: 'الهدف: إطلاق النسخة الأولى من المنتج قبل نهاية الربع الحالي.\n\nالمحاور الرئيسية:\n• إنهاء تجربة المستخدم للوحة التحكم\n• اختبار الأداء على الأجهزة المحمولة\n• تجهيز المواد التسويقية وحملة الإطلاق\n• تدريب فريق الدعم على الأسئلة الشائعة\n\nالموعد المستهدف: 15 ديسمبر\nمسؤول المتابعة: فريق المنتج',
        category: 'work',
        color: 'sky',
        pinned: true,
        favorite: false,
        createdAt: now - 2 * day,
        updatedAt: now - 40 * 60 * 1000
      }),
      makeNote({
        title: 'مهام عاجلة لهذا اليوم',
        content: '• الرد على ملاحظات العملاء\n• مراجعة عرض الشرائح قبل الاجتماع\n• إرسال تقرير الأداء الأسبوعي\n• حجز قاعة الاجتماع يوم الخميس\n• متابعة الفاتورة رقم 1042',
        category: 'tasks',
        color: 'sand',
        pinned: true,
        favorite: true,
        createdAt: now - 5 * hour,
        updatedAt: now - 90 * 60 * 1000
      }),
      makeNote({
        title: 'أفكار لتجربة مستخدم أفضل',
        content: 'خمس أفكار قابلة للتطبيق:\n\n1. تقليل خطوات إنشاء الحساب إلى خطوتين فقط.\n2. حفظ المسودات تلقائياً كل بضع ثوانٍ.\n3. إظهار اختصارات لوحة المفاتيح في مكان واضح.\n4. تصميم حالة فارغة تساعد المستخدم على البدء.\n5. إرسال ملخص أسبوعي بما تم إنجازه.',
        category: 'ideas',
        color: 'violet',
        pinned: false,
        favorite: true,
        createdAt: now - 2 * day,
        updatedAt: now - 3 * hour
      }),
      makeNote({
        title: 'قائمة مشتريات الأسبوع',
        content: '• قهوة عربية\n• تمر وفواكه موسمية\n• أوراق طباعة A4\n• شاحن مكتبي\n• سماعات رأس هادئة\n\nملاحظة: المرور على الصيدلية مساءً.',
        category: 'personal',
        color: 'mint',
        pinned: false,
        favorite: false,
        createdAt: now - 1 * day,
        updatedAt: now - 6 * hour
      }),
      makeNote({
        title: 'مراجعة الاختبار النهائي',
        content: 'خطة المراجعة على مدى ثلاثة أيام:\n\nاليوم الأول: الفصول 1–3 وحل الأسئلة القصيرة.\nاليوم الثاني: الفصول 4–6 وملخص المفاهيم الأساسية.\nاليوم الثالث: اختبار تجريبي كامل ومراجعة الأخطاء.\n\nلا تنسَ أخذ فترات راحة قصيرة كل 45 دقيقة.',
        category: 'study',
        color: 'rose',
        pinned: false,
        favorite: true,
        createdAt: now - 4 * day,
        updatedAt: now - 1 * day
      }),
      makeNote({
        title: 'ملخص اجتماع فريق التصميم',
        content: '• اعتماد الهوية اللونية الجديدة قبل نهاية الأسبوع.\n• تحويل مكونات الواجهة إلى مكتبة موحدة.\n• مراجعة إمكانية الوصول لجميع الشاشات الرئيسية.\n• عرض النسخة الأولى على الإدارة يوم الأحد القادم.\n\nالقرار: تأجيل تغيير الخط إلى ما بعد الإطلاق.',
        category: 'work',
        color: 'default',
        pinned: false,
        favorite: false,
        createdAt: now - 1 * day,
        updatedAt: now - 22 * hour
      }),
      makeNote({
        title: 'اقتباس يستحق التذكر',
        content: '«الوضوح ليس صفة في التصميم فحسب، بل طريقة في التفكير.»\n\nملاحظة شخصية: اجعل كل شاشة تجيب على سؤال واحد واضح.',
        category: 'general',
        color: 'sand',
        pinned: false,
        favorite: true,
        createdAt: now - 6 * day,
        updatedAt: now - 5 * day
      })
    ];
  }

  /* ---------- Sharing & activity ---------- */
  function demoNotesPayload() {
    return buildDemoNotes().map(function (note) {
      return {
        id: note.id,
        title: note.title,
        content: note.content,
        category: note.category,
        color: note.color,
        pinned: note.pinned,
        favorite: note.favorite,
        created_at: new Date(note.createdAt).toISOString(),
        updated_at: new Date(note.updatedAt).toISOString()
      };
    });
  }

  async function createShare(noteId) {
    if (!currentUser) throw makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.');
    assertNotDemo('مشاركة ملاحظاته');

    var { data, error } = await requireClient().rpc('create_note_share', { p_note_id: noteId });
    if (error) throw dbError(error);
    if (!data || !data.token) {
      throw makeError('share-failed', 'تعذّر إنشاء رابط المشاركة. حاول مرة أخرى.');
    }

    return {
      shareId: data.share_id,
      token: String(data.token),
      expiresAt: parseDate(data.expires_at)
    };
  }

  async function revokeShare(shareId) {
    if (!currentUser) throw makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.');
    assertNotDemo('إدارة روابط المشاركة');

    var { data, error } = await requireClient().rpc('revoke_note_share', { p_share_id: shareId });
    if (error) throw dbError(error);
    return data === true;
  }

  async function getShareStatus(noteId) {
    if (!currentUser) throw makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.');
    assertNotDemo('إدارة روابط المشاركة');

    var { data, error } = await requireClient().rpc('get_note_share_status', { p_note_id: noteId });
    if (error) throw dbError(error);
    return mapShareStatus(data);
  }

  async function getSharedNote(token) {
    var clean = String(token || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) return null;

    var { data, error } = await requireClient().rpc('get_shared_note', { p_token: clean });
    if (error) throw dbError(error);
    return mapSharedNote(data);
  }

  async function listActivity(limit, before) {
    if (!currentUser) throw makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.');
    assertNotDemo('عرض سجل النشاط');

    var beforeIso = null;
    if (before) {
      var beforeTime = Number(before);
      if (Number.isFinite(beforeTime) && beforeTime > 0) {
        beforeIso = new Date(beforeTime).toISOString();
      }
    }

    var { data, error } = await requireClient().rpc('list_activity', {
      p_limit: Math.max(1, Math.min(100, Number(limit) || 30)),
      p_before: beforeIso
    });
    if (error) throw dbError(error);
    return (data || []).map(mapActivity);
  }

  async function resetDemoNotes() {
    if (!currentUser) throw makeError('not-authenticated', 'يرجى تسجيل الدخول أولاً.');
    if (!currentUser.isDemo) throw makeError('demo-restricted', 'هذه العملية متاحة للحساب التجريبي فقط.');

    var { data, error } = await requireClient().rpc('reset_demo_notes', { p_notes: demoNotesPayload() });
    if (error) throw dbError(error);

    currentUser.welcomeSeeded = true;
    return Number(data) || 0;
  }

  async function recordAuthEvent(eventType) {
    if (!currentUser || currentUser.isDemo) return false;
    if (eventType !== 'login' && eventType !== 'password_changed') return false;

    try {
      var { error } = await requireClient().rpc('record_auth_event', { p_event_type: eventType });
      if (error) {
        logError('activity', error);
        return false;
      }
      return true;
    } catch (error) {
      logError('activity', error);
      return false;
    }
  }

  /* ---------- Data portability ---------- */
  function exportData(user, notes) {
    return {
      app: 'important-notes',
      version: 2,
      storage: 'supabase',
      exportedAt: new Date().toISOString(),
      user: {
        name: user.name,
        email: user.email
      },
      notes: notes
    };
  }

  function parseImport(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw makeError('invalid-json', 'الملف ليس بصيغة JSON صحيحة.');
    }

    var list = null;
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && Array.isArray(parsed.notes)) {
      list = parsed.notes;
    } else if (parsed && parsed.data && Array.isArray(parsed.data.notes)) {
      list = parsed.data.notes;
    }

    if (!list) {
      throw makeError('invalid-format', 'صيغة الملف غير مدعومة. اختر ملف نسخة احتياطية من هذا التطبيق.');
    }

    var now = Date.now();
    var imported = [];

    list.slice(0, 2000).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var title = String(item.title || '').trim().slice(0, 160);
      var content = String(item.content || '').slice(0, 20000);
      if (!title && !content) return;
      if (!title) title = 'ملاحظة مستوردة';

      var createdAt = Number(item.createdAt);
      if (!Number.isFinite(createdAt) || createdAt <= 0) createdAt = now;
      var updatedAt = Number(item.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) updatedAt = createdAt;
      if (updatedAt < createdAt) updatedAt = createdAt;

      imported.push({
        id: uid(),
        title: title,
        content: content,
        category: validCategory(item.category),
        color: validColor(item.color),
        pinned: item.pinned === true,
        favorite: item.favorite === true,
        createdAt: createdAt,
        updatedAt: updatedAt
      });
    });

    if (imported.length === 0) {
      throw makeError('empty', 'لا توجد ملاحظات صالحة في هذا الملف.');
    }

    return imported;
  }

  /* ---------- Misc ---------- */
  function getUsage(notes) {
    try {
      var encoder = new TextEncoder();
      return encoder.encode(JSON.stringify(notes || [])).length;
    } catch (error) {
      return 0;
    }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 بايت';
    if (bytes < 1024) return bytes + ' بايت';
    if (bytes < 1024 * 1024) {
      var kb = bytes / 1024;
      return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' ك.ب';
    }
    var mb = bytes / (1024 * 1024);
    return mb.toFixed(1) + ' م.ب';
  }

  function countWords(notes) {
    var total = 0;
    (notes || []).forEach(function (note) {
      var titleWords = String(note.title || '').trim().split(/\s+/).filter(Boolean).length;
      var contentWords = String(note.content || '').trim().split(/\s+/).filter(Boolean).length;
      total += titleWords + contentWords;
    });
    return total;
  }

  /* ---------- Public API ---------- */
  window.HNStore = {
    CATEGORIES: CATEGORIES,
    NOTE_COLORS: NOTE_COLORS,
    AVATAR_COLORS: AVATAR_COLORS,
    DEMO_EMAIL: DEMO.email,

    init: init,
    isConfigured: isConfigured,
    restoreSession: restoreSession,
    signIn: signIn,
    signUp: signUp,
    signInDemo: signInDemo,
    signOut: signOut,
    updateProfile: updateProfile,
    changePassword: changePassword,
    deleteAccount: deleteAccount,

    getNotes: getNotes,
    saveNotes: saveNotes,
    makeNote: makeNote,
    makeWelcomeNote: makeWelcomeNote,
    savePrefs: savePrefs,

    createShare: createShare,
    revokeShare: revokeShare,
    getShareStatus: getShareStatus,
    getSharedNote: getSharedNote,
    listActivity: listActivity,
    resetDemoNotes: resetDemoNotes,
    recordAuthEvent: recordAuthEvent,

    exportData: exportData,
    parseImport: parseImport,
    getUsage: getUsage,
    formatBytes: formatBytes,
    countWords: countWords,
    errorMessage: errorMessage
  };

  // The CDN and config scripts are loaded before this file (all deferred in
  // document order), so the client can be created immediately.
  init();
})();
