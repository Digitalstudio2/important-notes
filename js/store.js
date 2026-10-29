/* ==========================================================================
   ملاحظات هامة — Local data layer (localStorage)
   ========================================================================== */
(function () {
  'use strict';

  var USERS_KEY = 'hn.users.v1';
  var SESSION_KEY = 'hn.session.v1';
  var NOTES_PREFIX = 'hn.notes.v1.';
  var PREFS_PREFIX = 'hn.prefs.v1.';
  var THEME_KEY = 'hn.theme.v1';

  var SESSION_DAYS = 30;
  var SESSION_HOURS = 12;

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
  var DEMO = {
    email: 'demo@notes.app',
    password: 'Demo@1234',
    name: 'سارة العتيبي'
  };

  function makeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function isStorageAvailable() {
    try {
      var key = '__hn_storage_test__';
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var value = JSON.parse(raw);
      return value === undefined || value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '_' + window.crypto.randomUUID();
    }
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 11);
  }

  function randomAvatarColor() {
    return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  }

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarColor: user.avatarColor || 'emerald',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  function getUsers() {
    var users = readJSON(USERS_KEY, []);
    return Array.isArray(users) ? users : [];
  }

  function saveUsers(users) {
    writeJSON(USERS_KEY, users);
  }

  function findUserByEmail(email) {
    var target = normalizeEmail(email);
    return getUsers().find(function (user) {
      return normalizeEmail(user.email) === target;
    }) || null;
  }

  function findUserById(id) {
    return getUsers().find(function (user) {
      return user.id === id;
    }) || null;
  }

  async function createUser(options) {
    var name = String(options.name || '').trim();
    var email = String(options.email || '').trim();
    var password = String(options.password || '');
    var avatarColor = AVATAR_COLORS.indexOf(options.avatarColor) !== -1
      ? options.avatarColor
      : randomAvatarColor();

    if (name.length < 2) {
      throw makeError('invalid-name', 'يرجى إدخال اسم صحيح.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw makeError('invalid-email', 'يرجى إدخال بريد إلكتروني صحيح.');
    }
    if (normalizeEmail(email) === DEMO.email && options.isDemo !== true) {
      throw makeError('email-reserved', 'هذا البريد مخصص للحساب التجريبي. يرجى استخدام بريد آخر.');
    }
    if (findUserByEmail(email)) {
      throw makeError('email-exists', 'هذا البريد الإلكتروني مسجّل مسبقاً على هذا الجهاز.');
    }
    if (password.length < 8) {
      throw makeError('weak-password', 'كلمة المرور يجب ألا تقل عن 8 أحرف.');
    }

    var passwordRecord = await window.HNHash.hashPassword(password);
    var now = Date.now();
    var user = {
      id: uid('usr'),
      name: name,
      email: email,
      password: passwordRecord,
      avatarColor: avatarColor,
      isDemo: options.isDemo === true,
      createdAt: now,
      updatedAt: now
    };

    var users = getUsers();
    users.push(user);
    saveUsers(users);
    return publicUser(user);
  }

  async function authenticate(email, password) {
    var user = findUserByEmail(email);
    if (!user) return null;

    var valid = await window.HNHash.verifyPassword(String(password || ''), user.password);
    return valid ? publicUser(user) : null;
  }

  function updateProfile(userId, changes) {
    var users = getUsers();
    var index = users.findIndex(function (user) { return user.id === userId; });
    if (index === -1) throw makeError('not-found', 'تعذّر العثور على الحساب.');

    var user = users[index];
    if (typeof changes.name === 'string') {
      var name = changes.name.trim();
      if (name.length < 2) throw makeError('invalid-name', 'يرجى إدخال اسم صحيح.');
      user.name = name.slice(0, 60);
    }
    if (typeof changes.avatarColor === 'string' && AVATAR_COLORS.indexOf(changes.avatarColor) !== -1) {
      user.avatarColor = changes.avatarColor;
    }
    user.updatedAt = Date.now();
    users[index] = user;
    saveUsers(users);
    return publicUser(user);
  }

  async function changePassword(userId, currentPassword, newPassword) {
    var users = getUsers();
    var index = users.findIndex(function (user) { return user.id === userId; });
    if (index === -1) throw makeError('not-found', 'تعذّر العثور على الحساب.');
    if (!newPassword || newPassword.length < 8) {
      throw makeError('weak-password', 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.');
    }

    var valid = await window.HNHash.verifyPassword(String(currentPassword || ''), users[index].password);
    if (!valid) {
      throw makeError('wrong-password', 'كلمة المرور الحالية غير صحيحة.');
    }

    users[index].password = await window.HNHash.hashPassword(newPassword);
    users[index].updatedAt = Date.now();
    saveUsers(users);
    return true;
  }

  function deleteAccount(userId) {
    var users = getUsers().filter(function (user) { return user.id !== userId; });
    saveUsers(users);
    try {
      localStorage.removeItem(NOTES_PREFIX + userId);
      localStorage.removeItem(PREFS_PREFIX + userId);
    } catch (error) {}
    clearSession();
  }

  /* ---------- Sessions ---------- */
  function startSession(userId, remember) {
    clearSession();
    var now = Date.now();
    var payload = {
      userId: userId,
      createdAt: now,
      expiresAt: remember
        ? now + SESSION_DAYS * 24 * 60 * 60 * 1000
        : now + SESSION_HOURS * 60 * 60 * 1000
    };

    try {
      if (remember) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
      } else {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
      }
    } catch (error) {
      throw makeError('storage', 'تعذّر إنشاء الجلسة. تحقق من إعدادات المتصفح.');
    }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (error) {}
    try { sessionStorage.removeItem(SESSION_KEY); } catch (error) {}
  }

  function readSession() {
    var stores = [];
    try { stores.push(sessionStorage); } catch (error) {}
    try { stores.push(localStorage); } catch (error) {}

    for (var i = 0; i < stores.length; i++) {
      try {
        var raw = stores[i].getItem(SESSION_KEY);
        if (!raw) continue;
        var payload = JSON.parse(raw);
        if (payload && payload.userId && payload.expiresAt) {
          return payload;
        }
        stores[i].removeItem(SESSION_KEY);
      } catch (error) {
        try { stores[i].removeItem(SESSION_KEY); } catch (e) {}
      }
    }
    return null;
  }

  function restoreSession() {
    var session = readSession();
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      clearSession();
      return null;
    }
    var user = findUserById(session.userId);
    if (!user) {
      clearSession();
      return null;
    }
    return publicUser(user);
  }

  /* ---------- Notes ---------- */
  function getNotes(userId) {
    var notes = readJSON(NOTES_PREFIX + userId, []);
    return Array.isArray(notes) ? notes : [];
  }

  function saveNotes(userId, notes) {
    writeJSON(NOTES_PREFIX + userId, Array.isArray(notes) ? notes : []);
  }

  function makeNote(data) {
    var now = Date.now();
    return {
      id: uid('note'),
      title: String(data.title || '').trim().slice(0, 160),
      content: String(data.content || '').slice(0, 20000),
      category: CATEGORIES.some(function (c) { return c.id === data.category; }) ? data.category : 'general',
      color: NOTE_COLORS.indexOf(data.color) !== -1 ? data.color : 'default',
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
      content: greeting + '\n\nهذه مساحتك الشخصية لتدوين كل ما يهمك، بعيداً عن أعين الآخرين. إليك بعض النصائح السريعة:\n\n• استخدم زر «ملاحظة جديدة» لتدوين فكرة في أي وقت.\n• ثبّت الملاحظات المهمة لتظهر في أعلى القائمة.\n• أضف ما تعود إليه كثيراً إلى المفضلة.\n• نظّم أفكارك عبر التصنيفات الملوّنة.\n• ابحث بسرعة بالضغط على Ctrl + K.\n\nملاحظاتك محفوظة على هذا الجهاز فقط، ولا يستطيع أي مستخدم آخر الوصول إليها.',
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

  async function ensureDemo() {
    var existing = findUserByEmail(DEMO.email);
    if (existing) {
      if (!existing.isDemo) {
        throw makeError('demo-conflict', 'هذا البريد مستخدم بحساب عادي على هذا الجهاز، لذلك لا يمكن فتح الحساب التجريبي. سجّل الدخول بكلمة المرور الخاصة بهذا الحساب.');
      }
      if (getNotes(existing.id).length === 0) {
        saveNotes(existing.id, buildDemoNotes());
      }
      return publicUser(existing);
    }

    var user = await createUser({
      name: DEMO.name,
      email: DEMO.email,
      password: DEMO.password,
      avatarColor: 'rose',
      isDemo: true
    });
    saveNotes(user.id, buildDemoNotes());
    savePrefs(user.id, { theme: 'light', layout: 'grid', sort: 'updated-desc' });
    return user;
  }

  /* ---------- Preferences ---------- */
  function getPrefs(userId) {
    var prefs = readJSON(PREFS_PREFIX + userId, {});
    if (!prefs || typeof prefs !== 'object') prefs = {};
    return {
      theme: ['light', 'dark', 'system'].indexOf(prefs.theme) !== -1 ? prefs.theme : 'system',
      layout: prefs.layout === 'list' ? 'list' : 'grid',
      sort: ['updated-desc', 'updated-asc', 'created-desc', 'title-asc'].indexOf(prefs.sort) !== -1
        ? prefs.sort
        : 'updated-desc'
    };
  }

  function savePrefs(userId, prefs) {
    writeJSON(PREFS_PREFIX + userId, prefs);
  }

  /* ---------- Data portability ---------- */
  function exportData(user, notes) {
    return {
      app: 'important-notes',
      version: 1,
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
        id: uid('note'),
        title: title,
        content: content,
        category: CATEGORIES.some(function (c) { return c.id === item.category; }) ? item.category : 'general',
        color: NOTE_COLORS.indexOf(item.color) !== -1 ? item.color : 'default',
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

  function getUsage(userId) {
    var bytes = 0;
    var encoder = new TextEncoder();
    var keys = [NOTES_PREFIX + userId, PREFS_PREFIX + userId];

    keys.forEach(function (key) {
      try {
        var raw = localStorage.getItem(key);
        if (raw) bytes += encoder.encode(raw).length;
      } catch (error) {}
    });

    var user = findUserById(userId);
    if (user) {
      try { bytes += encoder.encode(JSON.stringify(publicUser(user))).length; } catch (error) {}
    }

    return bytes;
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

  window.HNStore = {
    CATEGORIES: CATEGORIES,
    NOTE_COLORS: NOTE_COLORS,
    AVATAR_COLORS: AVATAR_COLORS,
    DEMO_EMAIL: DEMO.email,
    isStorageAvailable: isStorageAvailable,
    createUser: createUser,
    authenticate: authenticate,
    findUserByEmail: findUserByEmail,
    updateProfile: updateProfile,
    changePassword: changePassword,
    deleteAccount: deleteAccount,
    startSession: startSession,
    clearSession: clearSession,
    restoreSession: restoreSession,
    getNotes: getNotes,
    saveNotes: saveNotes,
    makeNote: makeNote,
    makeWelcomeNote: makeWelcomeNote,
    ensureDemo: ensureDemo,
    getPrefs: getPrefs,
    savePrefs: savePrefs,
    exportData: exportData,
    parseImport: parseImport,
    getUsage: getUsage,
    formatBytes: formatBytes,
    countWords: countWords
  };
})();
