/* ==========================================================================
   مساحة التدوين — Application logic
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  var CATEGORIES = window.HNStore.CATEGORIES;
  var CATEGORY_MAP = {};
  CATEGORIES.forEach(function (category) { CATEGORY_MAP[category.id] = category; });

  var NOTE_COLORS = window.HNStore.NOTE_COLORS;
  var AVATAR_COLORS = window.HNStore.AVATAR_COLORS;

  var COLOR_NAMES = {
    default: 'افتراضي',
    sand: 'رملي',
    mint: 'نعناعي',
    sky: 'سماوي',
    rose: 'وردي',
    violet: 'بنفسجي'
  };

  var AVATAR_NAMES = {
    emerald: 'زمردي',
    indigo: 'نيلي',
    rose: 'وردي',
    amber: 'ذهبي',
    sky: 'سماوي',
    violet: 'بنفسجي'
  };

  var DEFAULT_NOTE_COLORS = {
    work: 'sky',
    personal: 'mint',
    study: 'rose',
    ideas: 'violet',
    tasks: 'sand',
    general: 'default'
  };

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var STORAGE_LIMIT = 5 * 1024 * 1024;
  var ACTIVITY_PAGE_SIZE = 30;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var numberFormatter;
  try { numberFormatter = new Intl.NumberFormat('en-US'); } catch (error) { numberFormatter = null; }
  function formatNumber(value) {
    return numberFormatter ? numberFormatter.format(value) : String(value);
  }

  var dateFormatterFull;
  var dateFormatterShort;
  var monthYearFormatter;
  var relativeTimeFormatter;
  var dateTimeFormatter;
  try {
    dateFormatterFull = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    dateFormatterShort = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
    monthYearFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
      month: 'long', year: 'numeric'
    });
    dateTimeFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    relativeTimeFormatter = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  } catch (error) {
    dateFormatterFull = dateFormatterShort = monthYearFormatter = relativeTimeFormatter = dateTimeFormatter = null;
  }

  var state = {
    user: null,
    notes: [],
    prefs: { theme: 'system', layout: 'grid', sort: 'updated-desc' },
    filter: { type: 'all', category: null },
    query: '',
    sort: 'updated-desc',
    layout: 'grid',
    view: 'notes',
    editingId: null,
    editorColor: 'default',
    editorSnapshot: '',
    selectedAvatar: 'emerald',
    settingsTab: 'account',
    menuNoteId: null,
    menuButton: null,
    emptyAction: null,
    confirmConfig: null,
    confirmRequired: '',
    savingNote: false,
    blockedMessage: '',
    shareNoteId: null,
    shareStatus: null,
    shareToken: '',
    shareLink: '',
    shareLoading: false,
    shareBusy: false,
    activity: { items: [], loading: false, done: false, stale: false, error: '' }
  };

  var els = {};
  var overlayStack = [];
  var searchTimer = null;
  var sidebarTimer = null;

  /* ---------- Helpers ---------- */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function icon(name, className) {
    return '<svg class="icon ' + (className || '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function toLatinDigits(value) {
    return String(value).replace(/[٠-٩]/g, function (digit) {
      return String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
    }).replace(/[۰-۹]/g, function (digit) {
      return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));
    });
  }

  function normalizeArabic(value) {
    return String(value || '').toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || '';
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '؟';
    var letters = Array.from(parts[0])[0] || '';
    if (parts[1]) letters += Array.from(parts[1])[0] || '';
    return letters;
  }

  function getCategory(id) {
    return CATEGORY_MAP[id] || CATEGORY_MAP.general;
  }

  function getNote(id) {
    return state.notes.find(function (note) { return note.id === id; }) || null;
  }

  function notesPhrase(count) {
    if (count === 0) return 'لا توجد ملاحظات';
    if (count === 1) return 'ملاحظة واحدة';
    if (count === 2) return 'ملاحظتان';
    if (count >= 3 && count <= 10) return count + ' ملاحظات';
    return count + ' ملاحظة';
  }

  function notesPhraseObject(count) {
    if (count === 0) return 'لا ملاحظات';
    if (count === 1) return 'ملاحظة واحدة';
    if (count === 2) return 'ملاحظتين';
    if (count >= 3 && count <= 10) return count + ' ملاحظات';
    return count + ' ملاحظة';
  }

  function timeAgo(timestamp) {
    var diff = Math.max(0, Date.now() - Number(timestamp || 0));
    var minute = 60000;
    var hour = 60 * minute;
    var day = 24 * hour;

    if (diff < 45000) return 'الآن';
    if (relativeTimeFormatter) {
      if (diff < hour) {
        return toLatinDigits(relativeTimeFormatter.format(-Math.max(1, Math.round(diff / minute)), 'minute'));
      }
      if (diff < day) {
        return toLatinDigits(relativeTimeFormatter.format(-Math.round(diff / hour), 'hour'));
      }
      if (diff < 7 * day) {
        return toLatinDigits(relativeTimeFormatter.format(-Math.round(diff / day), 'day'));
      }
    }
    if (dateFormatterShort) {
      return toLatinDigits(dateFormatterShort.format(new Date(Number(timestamp))));
    }
    return 'منذ فترة';
  }

  function formatToday() {
    if (!dateFormatterFull) return '';
    return toLatinDigits(dateFormatterFull.format(new Date()));
  }

  function formatDateTime(timestamp) {
    var time = Number(timestamp);
    if (!Number.isFinite(time) || time <= 0) return '';
    if (dateTimeFormatter) return toLatinDigits(dateTimeFormatter.format(new Date(time)));
    if (dateFormatterShort) return toLatinDigits(dateFormatterShort.format(new Date(time)));
    return '';
  }

  function formatMemberSince(timestamp) {
    var days = (Date.now() - Number(timestamp || Date.now())) / 86400000;
    if (days < 7) return 'عضو جديد';
    if (!monthYearFormatter) return 'عضو';
    return 'عضو منذ ' + toLatinDigits(monthYearFormatter.format(new Date(Number(timestamp))));
  }

  function setAvatarAppearance(element, name, color, sizeClass) {
    if (!element) return;
    element.textContent = initials(name);
    element.className = 'avatar ' + (sizeClass || '') + ' avatar--' + (AVATAR_COLORS.indexOf(color) !== -1 ? color : 'emerald');
  }

  function setFormLoading(button, loading) {
    if (!button) return;
    button.classList.toggle('is-loading', !!loading);
    button.disabled = !!loading;
    button.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  function showAlert(element, message) {
    if (!element) return;
    element.innerHTML = icon('alert') + '<span>' + esc(message) + '</span>';
    element.hidden = false;
  }

  function hideAlert(element) {
    if (!element) return;
    element.hidden = true;
    element.textContent = '';
  }

  function showFieldError(input, message) {
    if (!input) return;
    var field = input.closest('.field');
    if (!field) return;
    field.classList.add('has-error');
    var error = field.querySelector('.field__error');
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  function clearFieldError(input) {
    if (!input) return;
    var field = input.closest('.field');
    if (!field) return;
    field.classList.remove('has-error');
    var error = field.querySelector('.field__error');
    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
  }

  function clearFormErrors(form) {
    if (!form) return;
    $$('.field.has-error', form).forEach(function (field) { field.classList.remove('has-error'); });
    $$('.field__error', form).forEach(function (error) {
      error.textContent = '';
      error.hidden = true;
    });
  }

  function shake(element) {
    if (!element || reducedMotion) return;
    element.classList.remove('shake');
    void element.offsetWidth;
    element.classList.add('shake');
  }

  function passwordScore(password) {
    var score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Za-z]/.test(password) && /\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return Math.min(score, 4);
  }

  function updateStrength(element, password) {
    if (!element) return;
    var score = password ? passwordScore(password) : 0;
    element.setAttribute('data-level', String(score));
    var label = element.querySelector('.strength__label');
    if (!label) return;
    var labels = ['قوة كلمة المرور', 'ضعيفة', 'متوسطة', 'جيدة', 'قوية'];
    label.textContent = labels[score];
  }

  function setPasswordToggle(button, input, visible) {
    input.type = visible ? 'text' : 'password';
    button.classList.toggle('is-visible', visible);
    button.setAttribute('aria-label', visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
  }

  /* ---------- Theme ---------- */
  function storedThemeMode() {
    try {
      var mode = localStorage.getItem('hn.theme.v1');
      return ['light', 'dark', 'system'].indexOf(mode) !== -1 ? mode : 'system';
    } catch (error) {
      return 'system';
    }
  }

  function effectiveTheme(mode) {
    if (mode === 'system') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
  }

  function applyTheme(mode, options) {
    options = options || {};
    if (['light', 'dark', 'system'].indexOf(mode) === -1) mode = 'system';

    document.documentElement.setAttribute('data-theme', effectiveTheme(mode));
    document.documentElement.setAttribute('data-theme-mode', mode);

    if (options.global !== false) {
      try { localStorage.setItem('hn.theme.v1', mode); } catch (error) {}
    }

    if (options.user && state.user) {
      state.prefs.theme = mode;
      window.HNStore.savePrefs(state.prefs).catch(function () {});
    }

    syncThemeControls();
  }

  function syncThemeControls() {
    var mode = document.documentElement.getAttribute('data-theme-mode') || 'system';
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (els.themeSwitch) els.themeSwitch.checked = isDark;

    $$('input[name="themeMode"]', els.themeOptions || document).forEach(function (input) {
      input.checked = input.value === mode;
    });
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next, { global: true, user: !!state.user });
  }

  /* ---------- Overlays ---------- */
  function syncBodyLock() {
    document.body.classList.toggle('has-overlay', overlayStack.length > 0);
  }

  function openOverlay(overlay, focusTarget) {
    if (!overlay) return;
    clearTimeout(overlay._hideTimer);
    overlay._lastFocus = document.activeElement && document.activeElement.focus ? document.activeElement : null;
    overlay.hidden = false;
    void overlay.offsetHeight;
    overlay.classList.add('is-open');

    var index = overlayStack.indexOf(overlay);
    if (index === -1) overlayStack.push(overlay);
    syncBodyLock();

    var target = focusTarget || overlay.querySelector('.modal__close') || overlay.querySelector('button, input, select, textarea');
    if (target) {
      setTimeout(function () {
        try { target.focus({ preventScroll: true }); } catch (error) {}
      }, reducedMotion ? 0 : 80);
    }
  }

  function closeOverlay(overlay, force) {
    if (!overlay) return;
    if (overlay.hidden && !overlay.classList.contains('is-open')) return;

    overlay.classList.remove('is-open');
    var index = overlayStack.indexOf(overlay);
    if (index !== -1) overlayStack.splice(index, 1);
    clearTimeout(overlay._hideTimer);
    var delay = reducedMotion ? 0 : 230;
    overlay._hideTimer = setTimeout(function () {
      if (!overlay.classList.contains('is-open')) overlay.hidden = true;
    }, delay);

    syncBodyLock();

    if (!force) {
      setTimeout(function () {
        var target = overlay._lastFocus;
        if (target && document.documentElement.contains(target) && !target.closest('[hidden]')) {
          try { target.focus({ preventScroll: true }); } catch (error) {}
        }
      }, delay);
    }
  }

  function closeAllOverlays() {
    overlayStack.slice().forEach(function (overlay) {
      clearTimeout(overlay._hideTimer);
      overlay.classList.remove('is-open');
      overlay.hidden = true;
    });
    overlayStack = [];
    syncBodyLock();
  }

  function focusableIn(overlay) {
    var modal = overlay.querySelector('.modal') || overlay;
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', modal)
      .filter(function (element) {
        return element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true' && !element.hidden;
      });
  }

  function trapFocus(overlay, event) {
    var focusables = focusableIn(overlay);
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = document.activeElement;

    if (!overlay.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function topOverlay() {
    return overlayStack.length ? overlayStack[overlayStack.length - 1] : null;
  }

  /* ---------- Toasts ---------- */
  function removeToast(element) {
    if (!element || element.classList.contains('is-leaving')) return;
    clearTimeout(element._timer);
    element.classList.add('is-leaving');
    setTimeout(function () {
      if (element.parentNode) element.parentNode.removeChild(element);
    }, reducedMotion ? 0 : 220);
  }

  function clearToasts() {
    if (els.toastRegion) els.toastRegion.innerHTML = '';
  }

  function toast(message, options) {
    options = options || {};
    if (!els.toastRegion) return;

    var type = options.type || 'success';
    var duration = typeof options.duration === 'number' ? options.duration : 4200;
    var element = document.createElement('div');
    element.className = 'toast' + (type === 'error' ? ' toast--error' : '');
    element.setAttribute('role', 'status');

    var iconName = type === 'error' ? 'alert' : (type === 'info' ? 'info' : 'check');
    var html = '<span class="toast__icon">' + icon(iconName) + '</span>' +
      '<span class="toast__message">' + esc(message) + '</span>';

    if (options.action && options.action.label) {
      html += '<button class="toast__action" type="button">' + esc(options.action.label) + '</button>';
    }

    html += '<button class="toast__close" type="button" aria-label="إغلاق التنبيه">' + icon('x') + '</button>' +
      '<span class="toast__progress" style="animation-duration:' + duration + 'ms"></span>';

    element.innerHTML = html;

    var existing = $$('.toast', els.toastRegion);
    if (existing.length >= 3) removeToast(existing[0]);

    els.toastRegion.appendChild(element);

    element.querySelector('.toast__close').addEventListener('click', function () {
      removeToast(element);
    });

    if (options.action && options.action.label) {
      element.querySelector('.toast__action').addEventListener('click', function () {
        removeToast(element);
        try {
          var result = options.action.onClick && options.action.onClick();
          if (result && result.catch) result.catch(function () {});
        } catch (error) {}
      });
    }

    element._timer = setTimeout(function () { removeToast(element); }, duration);
  }

  /* ---------- Auth mode ---------- */
  function setAuthMode(mode) {
    var isRegister = mode === 'register';
    els.tabLogin.classList.toggle('is-active', !isRegister);
    els.tabRegister.classList.toggle('is-active', isRegister);
    els.tabLogin.setAttribute('aria-selected', String(!isRegister));
    els.tabRegister.setAttribute('aria-selected', String(isRegister));
    els.tabLogin.tabIndex = isRegister ? -1 : 0;
    els.tabRegister.tabIndex = isRegister ? 0 : -1;

    els.loginPanel.hidden = isRegister;
    els.registerPanel.hidden = !isRegister;

    els.authHeading.textContent = isRegister ? 'أنشئ مساحتك الخاصة' : 'مرحباً بعودتك';
    els.authSubheading.textContent = isRegister
      ? 'حساب واحد، وخصوصية كاملة لكل ما تدوّنه.'
      : 'سجّل الدخول للوصول إلى ملاحظاتك الخاصة ومتابعة أفكارك.';

    hideAlert(els.loginAlert);
    hideAlert(els.registerAlert);

    if (state.blockedMessage) {
      showAlert(els.loginAlert, state.blockedMessage);
      showAlert(els.registerAlert, state.blockedMessage);
    }

    document.title = isRegister ? 'إنشاء حساب — مساحة التدوين' : 'مساحة التدوين — مساحتك الشخصية';
  }

  /* ---------- Elements & static UI ---------- */
  function cacheElements() {
    els.authView = $('#authView');
    els.appView = $('#appView');
    els.authThemeToggle = $('#authThemeToggle');
    els.tabLogin = $('#tabLogin');
    els.tabRegister = $('#tabRegister');
    els.loginPanel = $('#loginPanel');
    els.registerPanel = $('#registerPanel');
    els.authHeading = $('#authHeading');
    els.authSubheading = $('#authSubheading');
    els.loginForm = $('#loginForm');
    els.loginAlert = $('#loginAlert');
    els.loginEmail = $('#loginEmail');
    els.loginPassword = $('#loginPassword');
    els.rememberMe = $('#rememberMe');
    els.loginSubmit = $('#loginSubmit');
    els.forgotBtn = $('#forgotBtn');
    els.forgotForm = $('#forgotForm');
    els.forgotAlert = $('#forgotAlert');
    els.forgotEmail = $('#forgotEmail');
    els.forgotEmailField = $('#forgotEmailField');
    els.forgotSubmit = $('#forgotSubmit');
    els.forgotSuccess = $('#forgotSuccess');
    els.registerForm = $('#registerForm');
    els.registerAlert = $('#registerAlert');
    els.registerName = $('#registerName');
    els.registerEmail = $('#registerEmail');
    els.registerPassword = $('#registerPassword');
    els.registerConfirm = $('#registerConfirm');
    els.registerSubmit = $('#registerSubmit');
    els.passwordStrength = $('#passwordStrength');
    els.demoBtn = $('#demoBtn');
    els.authYear = $('#authYear');

    els.sidebarOverlay = $('#sidebarOverlay');
    els.sidebar = $('#sidebar');
    els.sidebarClose = $('#sidebarClose');
    els.brandHome = $('#brandHome');
    els.menuBtn = $('#menuBtn');
    els.sidebarAvatar = $('#sidebarAvatar');
    els.sidebarName = $('#sidebarName');
    els.sidebarEmail = $('#sidebarEmail');
    els.openSettingsBtn = $('#openSettingsBtn');
    els.countAll = $('#countAll');
    els.countPinned = $('#countPinned');
    els.countFavorites = $('#countFavorites');
    els.categoryNav = $('#categoryNav');
    els.storageCard = $('#storageCard');
    els.storagePercent = $('#storagePercent');
    els.storageBar = $('#storageBar');
    els.storageText = $('#storageText');
    els.themeSwitch = $('#themeSwitch');
    els.settingsBtn = $('#settingsBtn');
    els.logoutBtn = $('#logoutBtn');
    els.activityNavBtn = $('#activityNavBtn');

    els.searchInput = $('#searchInput');
    els.searchClear = $('#searchClear');
    els.topbarTheme = $('#topbarTheme');
    els.newNoteTop = $('#newNoteTop');
    els.topbarProfile = $('#topbarProfile');
    els.topbarAvatar = $('#topbarAvatar');
    els.todayLabel = $('#todayLabel');
    els.greeting = $('#greeting');
    els.greetingSub = $('#greetingSub');
    els.newNoteBtn = $('#newNoteBtn');
    els.statTotal = $('#statTotal');
    els.statPinned = $('#statPinned');
    els.statFavorites = $('#statFavorites');
    els.statWords = $('#statWords');
    els.notesTitle = $('#notesTitle');
    els.notesCount = $('#notesCount');
    els.sortSelect = $('#sortSelect');
    els.gridViewBtn = $('#gridViewBtn');
    els.listViewBtn = $('#listViewBtn');
    els.notesGrid = $('#notesGrid');
    els.emptyState = $('#emptyState');
    els.emptyTitle = $('#emptyTitle');
    els.emptyText = $('#emptyText');
    els.emptyAction = $('#emptyAction');
    els.emptyActionLabel = $('#emptyActionLabel');

    els.pageIntro = $('.page-intro');
    els.stats = $('.stats');
    els.notesSection = $('.notes-section');
    els.activitySection = $('#activitySection');
    els.activityBackBtn = $('#activityBackBtn');
    els.activityRefreshBtn = $('#activityRefreshBtn');
    els.activityError = $('#activityError');
    els.activityLoading = $('#activityLoading');
    els.activityList = $('#activityList');
    els.activityEmpty = $('#activityEmpty');
    els.activityEmptyTitle = $('#activityEmptyTitle');
    els.activityEmptyText = $('#activityEmptyText');
    els.activityRetryBtn = $('#activityRetryBtn');
    els.activityMoreWrap = $('#activityMoreWrap');
    els.activityMoreBtn = $('#activityMoreBtn');
    els.activityCount = $('#activityCount');

    els.editorOverlay = $('#editorOverlay');
    els.editorTitleLabel = $('#editorTitleLabel');
    els.editorForm = $('#editorForm');
    els.noteTitle = $('#noteTitle');
    els.noteTitleError = $('#noteTitleError');
    els.noteCategory = $('#noteCategory');
    els.colorSwatches = $('#colorSwatches');
    els.notePinned = $('#notePinned');
    els.noteFavorite = $('#noteFavorite');
    els.wordCount = $('#wordCount');
    els.noteContent = $('#noteContent');
    els.editorMeta = $('#editorMeta');
    els.saveNoteBtn = $('#saveNoteBtn');

    els.settingsOverlay = $('#settingsOverlay');
    els.settingsStorageText = $('#settingsStorageText');
    els.settingsStorageBar = $('#settingsStorageBar');
    els.accountForm = $('#accountForm');
    els.accountName = $('#accountName');
    els.accountNameError = $('#accountNameError');
    els.accountEmail = $('#accountEmail');
    els.profileAvatar = $('#profileAvatar');
    els.profileNamePreview = $('#profileNamePreview');
    els.profileEmailView = $('#profileEmailView');
    els.memberSince = $('#memberSince');
    els.avatarColors = $('#avatarColors');
    els.saveAccountBtn = $('#saveAccountBtn');
    els.passwordForm = $('#passwordForm');
    els.currentPassword = $('#currentPassword');
    els.currentPasswordError = $('#currentPasswordError');
    els.newPassword = $('#newPassword');
    els.newPasswordError = $('#newPasswordError');
    els.confirmNewPassword = $('#confirmNewPassword');
    els.confirmNewPasswordError = $('#confirmNewPasswordError');
    els.updatePasswordBtn = $('#updatePasswordBtn');
    els.newPasswordStrength = $('#newPasswordStrength');
    els.exportBtn = $('#exportBtn');
    els.importBtn = $('#importBtn');
    els.importInput = $('#importInput');
    els.deleteAllBtn = $('#deleteAllBtn');
    els.deleteAccountBtn = $('#deleteAccountBtn');
    els.themeOptions = $('#themeOptions');

    els.shareOverlay = $('#shareOverlay');
    els.shareNotePreview = $('#shareNotePreview');
    els.shareNoteCategory = $('#shareNoteCategory');
    els.shareNoteTitle = $('#shareNoteTitle');
    els.shareNoteExcerpt = $('#shareNoteExcerpt');
    els.shareAlert = $('#shareAlert');
    els.shareState = $('#shareState');
    els.shareMeta = $('#shareMeta');
    els.shareActions = $('#shareActions');

    els.confirmOverlay = $('#confirmOverlay');
    els.confirmIcon = $('#confirmIcon');
    els.confirmTitle = $('#confirmTitle');
    els.confirmMessage = $('#confirmMessage');
    els.confirmInputWrap = $('#confirmInputWrap');
    els.confirmInput = $('#confirmInput');
    els.confirmInputLabel = $('#confirmInputLabel');
    els.confirmAccept = $('#confirmAccept');
    els.confirmCancel = $('#confirmCancel');

    els.forgotOverlay = $('#forgotOverlay');
    els.forgotCancel = $('#forgotCancel');
    els.noteMenu = $('#noteMenu');
    els.toastRegion = $('#toastRegion');
  }

  function buildStaticOptions() {
    els.noteCategory.innerHTML = CATEGORIES.map(function (category) {
      return '<option value="' + category.id + '">' + esc(category.name) + '</option>';
    }).join('');
    els.noteCategory.value = 'general';

    els.colorSwatches.innerHTML = NOTE_COLORS.map(function (color) {
      return '<button type="button" class="swatch swatch--' + color + '" data-color="' + color + '" aria-label="' + esc(COLOR_NAMES[color]) + '" aria-pressed="false">' + icon('check') + '</button>';
    }).join('');

    els.avatarColors.innerHTML = AVATAR_COLORS.map(function (color) {
      return '<button type="button" class="avatar-color avatar--' + color + '" data-avatar="' + color + '" aria-label="' + esc(AVATAR_NAMES[color]) + '" aria-pressed="false">' + icon('check') + '</button>';
    }).join('');

    els.authYear.textContent = new Date().getFullYear();
  }

  /* ---------- Session views ---------- */
  function showAuth() {
    closeAllOverlays();
    closeNoteMenu();
    closeSidebar(true);
    clearToasts();
    state.user = null;
    state.notes = [];
    state.prefs = { theme: 'system', layout: 'grid', sort: 'updated-desc' };
    state.filter = { type: 'all', category: null };
    state.query = '';
    state.editingId = null;
    state.view = 'notes';
    resetActivityState();
    resetShareState();
    document.body.classList.remove('is-demo');

    els.appView.hidden = true;
    els.authView.hidden = false;
    els.loginPassword.value = '';
    els.registerPassword.value = '';
    els.registerConfirm.value = '';
    updateStrength(els.passwordStrength, '');
    setAuthMode('login');
    applyTheme(storedThemeMode(), { global: false, user: false });
    document.title = 'مساحة التدوين — مساحتك الشخصية';

    if (window.innerWidth > 1024) {
      setTimeout(function () {
        try { els.loginEmail.focus({ preventScroll: true }); } catch (error) {}
      }, reducedMotion ? 0 : 120);
    }
  }

  async function enterApp(user, options) {
    options = options || {};
    state.user = user;
    state.prefs = user.prefs || { theme: 'system', layout: 'grid', sort: 'updated-desc' };

    var notes = [];
    try {
      notes = await window.HNStore.getNotes();
    } catch (error) {
      toast(window.HNStore.errorMessage(error), { type: 'error', duration: 7000 });
    }

    state.notes = notes;
    state.filter = { type: 'all', category: null };
    state.query = '';
    state.sort = state.prefs.sort;
    state.layout = state.prefs.layout;
    state.editingId = null;
    state.selectedAvatar = user.avatarColor;
    state.view = 'notes';
    resetActivityState();
    resetShareState();

    els.authView.hidden = true;
    els.appView.hidden = false;
    els.searchInput.value = '';
    els.searchClear.hidden = true;

    closeAllOverlays();
    closeNoteMenu();
    closeSidebar(true);
    clearToasts();
    applyTheme(state.prefs.theme, { global: true, user: false });

    els.todayLabel.textContent = formatToday();
    setView('notes');
    renderAll({ animate: true });

    document.title = 'ملاحظاتي — مساحة التدوين';
    window.scrollTo(0, 0);

    if (options.toast) {
      toast(options.toast, { type: 'success', duration: 4200 });
    }
  }

  /* ---------- Rendering ---------- */
  function renderAll(options) {
    renderUser();
    renderNav();
    renderCategories();
    renderStats();
    renderNotesSection(options);
    renderStorage();
    els.sortSelect.value = state.sort;
    syncLayoutButtons();
    els.searchClear.hidden = !els.searchInput.value;
  }

  function renderUser() {
    if (!state.user) return;
    document.body.classList.toggle('is-demo', !!state.user.isDemo);
    els.sidebarName.textContent = state.user.name;
    els.sidebarEmail.textContent = state.user.email;
    setAvatarAppearance(els.sidebarAvatar, state.user.name, state.user.avatarColor, 'avatar--md');
    setAvatarAppearance(els.topbarAvatar, state.user.name, state.user.avatarColor, 'avatar--sm');
  }

  function renderNav() {
    var counts = {
      all: state.notes.length,
      pinned: state.notes.filter(function (note) { return note.pinned; }).length,
      favorites: state.notes.filter(function (note) { return note.favorite; }).length
    };

    els.countAll.textContent = formatNumber(counts.all);
    els.countPinned.textContent = formatNumber(counts.pinned);
    els.countFavorites.textContent = formatNumber(counts.favorites);

    updateNavView();
  }

  function updateNavView() {
    var onNotes = state.view === 'notes';

    $$('.nav-item[data-filter]').forEach(function (button) {
      var active = onNotes && state.filter.type === button.getAttribute('data-filter');
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    if (els.activityNavBtn) {
      var active = state.view === 'activity';
      els.activityNavBtn.classList.toggle('is-active', active);
      if (active) els.activityNavBtn.setAttribute('aria-current', 'page');
      else els.activityNavBtn.removeAttribute('aria-current');
    }
  }

  function setView(view) {
    state.view = view === 'activity' ? 'activity' : 'notes';
    var onActivity = state.view === 'activity';

    if (els.pageIntro) els.pageIntro.hidden = onActivity;
    if (els.stats) els.stats.hidden = onActivity;
    if (els.notesSection) els.notesSection.hidden = onActivity;
    if (els.activitySection) els.activitySection.hidden = !onActivity;

    updateNavView();
    document.title = onActivity ? 'سجل النشاط — مساحة التدوين' : 'ملاحظاتي — مساحة التدوين';
  }

  function renderCategories() {
    var counts = {};
    state.notes.forEach(function (note) {
      var categoryId = CATEGORY_MAP[note.category] ? note.category : 'general';
      counts[categoryId] = (counts[categoryId] || 0) + 1;
    });

    els.categoryNav.innerHTML = CATEGORIES.map(function (category) {
      var active = state.filter.type === 'category' && state.filter.category === category.id;
      return '<button type="button" class="category-item' + (active ? ' is-active' : '') + '" data-category="' + category.id + '"' + (active ? ' aria-current="true"' : '') + '>' +
        '<span class="category-dot" style="background:' + category.color + '"></span>' +
        '<span class="category-item__name">' + esc(category.name) + '</span>' +
        '<span class="category-item__count">' + formatNumber(counts[category.id] || 0) + '</span>' +
        '</button>';
    }).join('');
  }

  function renderStats() {
    var pinned = state.notes.filter(function (note) { return note.pinned; }).length;
    var favorites = state.notes.filter(function (note) { return note.favorite; }).length;
    var words = window.HNStore.countWords(state.notes);

    els.statTotal.textContent = formatNumber(state.notes.length);
    els.statPinned.textContent = formatNumber(pinned);
    els.statFavorites.textContent = formatNumber(favorites);
    els.statWords.textContent = formatNumber(words);
    updateGreeting();
  }

  function updateGreeting() {
    if (!state.user) return;
    var name = firstName(state.user.name);
    var hour = new Date().getHours();
    var greeting = hour < 12 ? 'صباح الخير' : 'مساء الخير';
    els.greeting.textContent = greeting + (name ? '، ' + name : '');

    var total = state.notes.length;
    if (total === 0) {
      els.greetingSub.textContent = 'مساحتك جاهزة — ابدأ بتدوين أول ملاحظة.';
      return;
    }

    var pinned = state.notes.filter(function (note) { return note.pinned; }).length;
    var text = 'لديك ' + notesPhrase(total);
    if (pinned === 1) text += '، إحداها مثبتة';
    else if (pinned === 2) text += '، اثنتان منها مثبتتان';
    else if (pinned > 2) text += '، ' + pinned + ' منها مثبتة';
    els.greetingSub.textContent = text + '.';
  }

  function wordCountFor(note) {
    var titleWords = String(note.title || '').trim().split(/\s+/).filter(Boolean).length;
    var contentWords = String(note.content || '').trim().split(/\s+/).filter(Boolean).length;
    return titleWords + contentWords;
  }

  function filteredNotes() {
    var query = normalizeArabic(state.query);
    var list = state.notes.filter(function (note) {
      if (state.filter.type === 'pinned' && !note.pinned) return false;
      if (state.filter.type === 'favorites' && !note.favorite) return false;
      if (state.filter.type === 'category' && note.category !== state.filter.category) return false;

      if (query) {
        var haystack = normalizeArabic(
          String(note.title || '') + ' ' +
          String(note.content || '') + ' ' +
          getCategory(note.category).name
        );
        if (haystack.indexOf(query) === -1) return false;
      }
      return true;
    });

    var sorters = {
      'updated-desc': function (a, b) { return b.updatedAt - a.updatedAt; },
      'updated-asc': function (a, b) { return a.updatedAt - b.updatedAt; },
      'created-desc': function (a, b) { return b.createdAt - a.createdAt; },
      'title-asc': function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'ar', { sensitivity: 'base' }); }
    };
    var sorter = sorters[state.sort] || sorters['updated-desc'];

    list.sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return sorter(a, b);
    });

    return list;
  }

  function noteCardHtml(note, index) {
    var category = getCategory(note.category);
    var color = NOTE_COLORS.indexOf(note.color) !== -1 ? note.color : 'default';
    var hasContent = String(note.content || '').trim().length > 0;
    var words = wordCountFor(note);
    var flags = '';

    if (note.pinned) {
      flags += '<span class="note__flag note__flag--pin" title="مثبتة" aria-label="مثبتة">' + icon('pin-fill') + '</span>';
    }
    if (note.favorite) {
      flags += '<span class="note__flag note__flag--fav" title="في المفضلة" aria-label="في المفضلة">' + icon('heart-fill') + '</span>';
    }

    return '<article class="note" data-note-id="' + esc(note.id) + '" data-color="' + color + '" style="--i:' + Math.min(index, 10) + '" tabindex="0" role="button">' +
      '<span class="visually-hidden">فتح الملاحظة: </span>' +
      '<div class="note__top">' +
        '<span class="note-chip"><i style="background:' + category.color + '"></i>' + esc(category.name) + '</span>' +
        '<div class="note__flags">' + flags +
          '<button class="note__more" type="button" data-menu-note="' + esc(note.id) + '" aria-label="خيارات الملاحظة" aria-haspopup="menu" aria-expanded="false">' + icon('more') + '</button>' +
        '</div>' +
      '</div>' +
      '<h3 class="note__title">' + esc(note.title || 'بدون عنوان') + '</h3>' +
      '<p class="note__excerpt' + (hasContent ? '' : ' is-empty') + '">' + (hasContent ? esc(note.content) : 'لا يوجد محتوى إضافي') + '</p>' +
      '<footer class="note__foot">' +
        '<span class="note__time">' + icon('clock') + timeAgo(note.updatedAt) + '</span>' +
        '<span class="note__words">' + formatNumber(words) + ' كلمة</span>' +
      '</footer>' +
    '</article>';
  }

  function setEmptyState(title, text, actionLabel, actionIcon, action) {
    els.emptyTitle.textContent = title;
    els.emptyText.textContent = text;
    els.emptyActionLabel.textContent = actionLabel;
    var use = els.emptyAction.querySelector('use');
    if (use) use.setAttribute('href', '#i-' + actionIcon);
    state.emptyAction = action;
  }

  function renderNotesSection(options) {
    options = options || {};
    var list = filteredNotes();
    var baseTitle;

    if (state.filter.type === 'pinned') baseTitle = 'الملاحظات المثبتة';
    else if (state.filter.type === 'favorites') baseTitle = 'المفضلة';
    else if (state.filter.type === 'category') baseTitle = getCategory(state.filter.category).name;
    else baseTitle = 'كل الملاحظات';

    var searching = state.query.trim().length > 0;
    els.notesTitle.textContent = searching ? 'نتائج البحث' : baseTitle;
    els.notesCount.textContent = formatNumber(list.length);
    document.title = (searching ? 'نتائج البحث' : baseTitle) + ' — مساحة التدوين';

    els.notesGrid.classList.toggle('is-list', state.layout === 'list');
    els.notesGrid.classList.remove('is-animated');

    if (list.length === 0) {
      els.notesGrid.innerHTML = '';
      els.notesGrid.hidden = true;
      els.emptyState.hidden = false;

      if (state.notes.length === 0) {
        setEmptyState(
          'مساحتك جاهزة لأفكارك',
          'ابدأ بتدوين أول ملاحظة، وستجد كل شيء في مكانه عندما تحتاجه.',
          'أنشئ ملاحظتك الأولى',
          'plus',
          function () { openEditor(null); }
        );
      } else if (searching) {
        setEmptyState(
          'لا توجد نتائج مطابقة',
          'لم نعثر على ملاحظات تطابق «' + state.query.trim() + '». جرّب كلمة أخرى أو امسح البحث.',
          'مسح البحث',
          'x',
          function () { clearSearch(true); }
        );
      } else if (state.filter.type === 'pinned') {
        setEmptyState(
          'لا توجد ملاحظات مثبتة',
          'ثبّت الملاحظات المهمة من قائمة الخيارات لتظهر هنا دائماً في الأعلى.',
          'عرض كل الملاحظات',
          'note',
          function () { setFilter('all'); }
        );
      } else if (state.filter.type === 'favorites') {
        setEmptyState(
          'المفضلة فارغة',
          'أضف الملاحظات التي تعود إليها كثيراً إلى المفضلة لتجدها بسرعة.',
          'عرض كل الملاحظات',
          'note',
          function () { setFilter('all'); }
        );
      } else if (state.filter.type === 'category') {
        var category = getCategory(state.filter.category);
        setEmptyState(
          'لا توجد ملاحظات في «' + category.name + '»',
          'هذا التصنيف جاهز لملاحظاتك القادمة. ابدأ بإضافة واحدة الآن.',
          'أضف ملاحظة',
          'plus',
          function () { openEditor(null); }
        );
      } else {
        setEmptyState(
          'لا توجد ملاحظات بعد',
          'ابدأ بتدوين أول ملاحظة، وستجد كل شيء في مكانه عندما تحتاجه.',
          'أنشئ ملاحظتك الأولى',
          'plus',
          function () { openEditor(null); }
        );
      }
      return;
    }

    els.notesGrid.hidden = false;
    els.emptyState.hidden = true;
    if (options.animate) {
      els.notesGrid.classList.add('is-animated');
      setTimeout(function () { els.notesGrid.classList.remove('is-animated'); }, 900);
    }
    els.notesGrid.innerHTML = list.map(noteCardHtml).join('');
  }

  function syncLayoutButtons() {
    els.gridViewBtn.classList.toggle('is-active', state.layout === 'grid');
    els.listViewBtn.classList.toggle('is-active', state.layout === 'list');
    els.gridViewBtn.setAttribute('aria-pressed', String(state.layout === 'grid'));
    els.listViewBtn.setAttribute('aria-pressed', String(state.layout === 'list'));
  }

  function renderStorage() {
    if (!state.user) return;
    var bytes = window.HNStore.getUsage(state.notes);
    var percentage = Math.min(100, (bytes / STORAGE_LIMIT) * 100);
    var percentageLabel = percentage > 0 && percentage < 1 ? '<1%' : Math.round(percentage) + '%';

    els.storagePercent.textContent = percentageLabel;
    els.storageText.textContent = window.HNStore.formatBytes(bytes) + ' محفوظة في حسابك';
    els.storageBar.style.width = Math.max(percentage, bytes > 0 ? 2 : 0).toFixed(1) + '%';
    els.storageCard.classList.toggle('is-high', percentage >= 80);

    if (els.settingsStorageText) {
      els.settingsStorageText.textContent = window.HNStore.formatBytes(bytes) + ' محفوظة في حسابك';
      els.settingsStorageBar.style.width = Math.max(percentage, bytes > 0 ? 2 : 0).toFixed(1) + '%';
    }
  }

  /* ---------- Activity log ---------- */
  var ACTIVITY_META = {
    account_created: { label: 'إنشاء الحساب', icon: 'sparkles', tone: 'brand' },
    login: { label: 'تسجيل دخول', icon: 'login', tone: 'info' },
    password_changed: { label: 'تغيير كلمة المرور', icon: 'key', tone: 'warning' },
    profile_updated: { label: 'تحديث الملف الشخصي', icon: 'user', tone: 'brand' },
    note_created: { label: 'ملاحظة جديدة', icon: 'plus', tone: 'brand' },
    note_updated: { label: 'تعديل ملاحظة', icon: 'pencil', tone: 'info' },
    note_deleted: { label: 'حذف ملاحظة', icon: 'trash', tone: 'danger' },
    share_created: { label: 'إنشاء رابط مشاركة', icon: 'share', tone: 'accent' },
    share_revoked: { label: 'إلغاء رابط مشاركة', icon: 'link-off', tone: 'danger' }
  };

  var ACTIVITY_FIELD_LABELS = {
    title: 'العنوان',
    content: 'المحتوى',
    category: 'التصنيف',
    color: 'اللون',
    pinned: 'التثبيت',
    favorite: 'المفضلة',
    name: 'الاسم',
    avatar_color: 'لون الصورة'
  };

  function resetActivityState() {
    state.activity = { items: [], loading: false, done: false, stale: false, error: '' };
    if (els.activityList) els.activityList.innerHTML = '';
    if (els.activityEmpty) els.activityEmpty.hidden = true;
    if (els.activityLoading) els.activityLoading.hidden = true;
    if (els.activityMoreWrap) els.activityMoreWrap.hidden = true;
    if (els.activityError) hideAlert(els.activityError);
    if (els.activityCount) els.activityCount.textContent = '0';
  }

  function invalidateActivity() {
    if (!state.activity) return;
    state.activity.stale = true;
  }

  function activityDayStart(timestamp) {
    var date = new Date(Number(timestamp));
    if (isNaN(date.getTime())) return 0;
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function activityDayLabel(timestamp) {
    var day = activityDayStart(timestamp);
    var today = activityDayStart(Date.now());
    if (day === today) return 'اليوم';
    if (day === today - 86400000) return 'أمس';
    if (dateFormatterFull) return toLatinDigits(dateFormatterFull.format(new Date(Number(timestamp))));
    if (dateFormatterShort) return toLatinDigits(dateFormatterShort.format(new Date(Number(timestamp))));
    return 'سابقاً';
  }

  function activityChangedLabels(item) {
    var changed = item.metadata && item.metadata.changed;
    if (!Array.isArray(changed)) return [];
    return changed.map(function (field) {
      return ACTIVITY_FIELD_LABELS[field] || '';
    }).filter(Boolean);
  }

  function activityDescription(item) {
    var metadata = item.metadata || {};
    var title = metadata.title ? String(metadata.title).trim() : '';
    var quoted = title ? '«' + esc(title) + '»' : 'الملاحظة';
    var category = metadata.category ? getCategory(metadata.category) : null;
    var categoryText = category ? ' في تصنيف «' + esc(category.name) + '»' : '';
    var changed = activityChangedLabels(item);
    var changedText = changed.length ? changed.join('، ') : '';
    var expiresTime = metadata.expires_at ? Date.parse(metadata.expires_at) : 0;
    var expires = Number.isFinite(expiresTime) && expiresTime > 0 ? formatDateTime(expiresTime) : '';

    switch (item.eventType) {
      case 'note_created':
        return 'أُضيفت ' + quoted + categoryText + '.';
      case 'note_updated':
        return 'عُدّلت ' + quoted + (changedText ? ' — ' + esc(changedText) : '') + '.';
      case 'note_deleted':
        return 'حُذفت ' + quoted + categoryText + '.';
      case 'share_created':
        return 'أُنشئ رابط قراءة فقط' + (expires ? ' صالح حتى ' + esc(expires) : '') + '.';
      case 'share_revoked':
        return metadata.reason === 'replaced'
          ? 'أُلغي الرابط السابق تلقائياً عند إنشاء رابط جديد.'
          : 'أُلغي رابط المشاركة يدوياً.';
      case 'profile_updated':
        return 'تم تحديث ' + (changedText ? esc(changedText) : 'معلومات الملف الشخصي') + '.';
      case 'account_created':
        return 'تم إنشاء الحساب وبدأ سجل النشاط.';
      case 'login':
        return 'تم تسجيل الدخول إلى حسابك.';
      case 'password_changed':
        return 'تم تغيير كلمة مرور الحساب.';
      default:
        return '';
    }
  }

  function activityItemHtml(item) {
    var meta = ACTIVITY_META[item.eventType] || { label: 'نشاط', icon: 'info', tone: 'info' };
    var date = new Date(item.createdAt);
    var iso = isNaN(date.getTime()) ? '' : date.toISOString();

    return '<article class="activity-item" role="listitem">' +
      '<span class="activity-item__icon activity-item__icon--' + meta.tone + '" aria-hidden="true">' + icon(meta.icon) + '</span>' +
      '<div class="activity-item__body">' +
        '<div class="activity-item__head">' +
          '<strong>' + esc(meta.label) + '</strong>' +
          '<time datetime="' + esc(iso) + '" title="' + esc(formatDateTime(item.createdAt)) + '">' + esc(timeAgo(item.createdAt)) + '</time>' +
        '</div>' +
        '<p class="activity-item__desc">' + activityDescription(item) + '</p>' +
      '</div>' +
    '</article>';
  }

  function activityListHtml(items) {
    var groups = [];
    var current = null;

    items.forEach(function (item) {
      var key = activityDayStart(item.createdAt);
      if (!current || current.key !== key) {
        current = { key: key, label: activityDayLabel(item.createdAt), items: [] };
        groups.push(current);
      }
      current.items.push(item);
    });

    return groups.map(function (group) {
      return '<div class="activity-day"><span>' + esc(group.label) + '</span></div>' +
        group.items.map(activityItemHtml).join('');
    }).join('');
  }

  function renderActivity() {
    if (!els.activityList) return;

    var activity = state.activity;
    var items = activity.items;
    var loading = activity.loading;
    var error = activity.error;

    els.activityCount.textContent = formatNumber(items.length) + (activity.done ? '' : '+');
    els.activityList.setAttribute('aria-busy', loading ? 'true' : 'false');
    els.activityLoading.hidden = !(loading && items.length === 0);
    els.activityList.hidden = items.length === 0;
    els.activityMoreWrap.hidden = !(items.length > 0 && !activity.done);
    els.activityMoreBtn.disabled = loading;
    setFormLoading(els.activityMoreBtn, loading);
    setFormLoading(els.activityRefreshBtn, loading);
    if (error) showAlert(els.activityError, error);
    else hideAlert(els.activityError);

    if (!items.length) {
      els.activityList.innerHTML = '';
      if (loading) {
        els.activityEmpty.hidden = true;
        return;
      }
      els.activityEmpty.hidden = false;
      if (error) {
        els.activityEmptyTitle.textContent = 'تعذّر تحميل سجل النشاط';
        els.activityEmptyText.textContent = error;
        els.activityRetryBtn.hidden = false;
      } else {
        els.activityEmptyTitle.textContent = 'لا يوجد نشاط بعد';
        els.activityEmptyText.textContent = 'ستظهر هنا كل التحديثات المهمة: الملاحظات، المشاركة، الملف الشخصي، وتسجيل الدخول.';
        els.activityRetryBtn.hidden = true;
      }
      return;
    }

    els.activityEmpty.hidden = true;
    els.activityList.innerHTML = activityListHtml(items);
  }

  async function loadActivity(reset) {
    if (!state.user || state.user.isDemo || state.activity.loading) return;

    if (reset) {
      state.activity.items = [];
      state.activity.done = false;
      state.activity.error = '';
    } else if (state.activity.done) {
      return;
    }

    state.activity.loading = true;
    state.activity.stale = false;
    renderActivity();

    try {
      var before = null;
      if (!reset && state.activity.items.length) {
        before = state.activity.items[state.activity.items.length - 1].createdAt;
      }
      var rows = await window.HNStore.listActivity(ACTIVITY_PAGE_SIZE, before);
      state.activity.items = state.activity.items.concat(rows);
      state.activity.done = rows.length < ACTIVITY_PAGE_SIZE;
      state.activity.error = '';
    } catch (error) {
      state.activity.error = window.HNStore.errorMessage(error);
    } finally {
      state.activity.loading = false;
      renderActivity();
    }
  }

  function showActivityView() {
    if (!state.user) return;
    if (state.user.isDemo) {
      toast('سجل النشاط غير متاح في الحساب التجريبي.', { type: 'info', duration: 3800 });
      return;
    }

    closeNoteMenu();
    closeSidebar();
    setView('activity');
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });

    if (state.activity.stale || (!state.activity.items.length && !state.activity.loading)) {
      loadActivity(true);
    } else {
      renderActivity();
    }
  }

  function showNotesView() {
    setView('notes');
    renderNav();
    renderNotesSection();
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  /* ---------- Sharing ---------- */
  function buildShareUrl(token) {
    var url = new URL('share.html', window.location.href);
    url.hash = token;
    return url.href;
  }

  function resetShareState() {
    state.shareNoteId = null;
    state.shareStatus = null;
    state.shareToken = '';
    state.shareLink = '';
    state.shareLoading = false;
    state.shareBusy = false;
    if (els.shareAlert) hideAlert(els.shareAlert);
  }

  function renderSharePreview(note) {
    if (!note || !els.shareNotePreview) return;
    var category = getCategory(note.category);
    var color = NOTE_COLORS.indexOf(note.color) !== -1 ? note.color : 'default';
    var content = String(note.content || '').trim();

    els.shareNotePreview.setAttribute('data-color', color);
    els.shareNoteCategory.innerHTML = '<i style="background:' + category.color + '"></i><span>' + esc(category.name) + '</span>';
    els.shareNoteTitle.textContent = note.title || 'بدون عنوان';
    els.shareNoteExcerpt.textContent = content
      ? content.slice(0, 180) + (content.length > 180 ? '…' : '')
      : 'لا يوجد محتوى إضافي';
  }

  function renderShareState() {
    if (!els.shareState || !els.shareActions) return;

    var disabled = state.shareBusy ? ' disabled' : '';

    if (state.shareLoading) {
      els.shareState.innerHTML = '<div class="share-loading"><span class="spinner" aria-hidden="true"></span><p>جارٍ التحقق من حالة المشاركة…</p></div>';
      els.shareActions.innerHTML = '<button class="btn btn--ghost" type="button" data-share-action="close">إغلاق</button>';
      els.shareMeta.textContent = 'مشاركة آمنة للقراءة فقط';
      return;
    }

    if (state.shareToken) {
      var successExpires = state.shareStatus ? formatDateTime(state.shareStatus.expiresAt) : '';
      els.shareState.innerHTML =
        '<div class="share-success">' +
          '<span class="share-success__icon" aria-hidden="true">' + icon('check') + '</span>' +
          '<div><strong>تم إنشاء رابط المشاركة</strong><p>انسخ الرابط الآن؛ لن يظهر مرة أخرى بعد إغلاق هذه النافذة.</p></div>' +
        '</div>' +
        '<div class="share-link-field">' +
          '<label for="shareLinkInput">رابط المشاركة</label>' +
          '<div class="share-link-row">' +
            '<input class="input share-link-input" id="shareLinkInput" type="text" readonly dir="ltr" value="' + esc(state.shareLink) + '">' +
            '<button class="btn btn--primary btn--sm" type="button" data-share-action="copy"' + disabled + '>' + icon('copy') + '<span>نسخ</span></button>' +
          '</div>' +
        '</div>' +
        (successExpires ? '<p class="share-expiry">' + icon('clock') + ' ينتهي في <strong>' + esc(successExpires) + '</strong></p>' : '') +
        '<p class="share-hint">' + icon('shield') + ' أي شخص لديه الرابط يمكنه قراءة الملاحظة فقط، دون تعديلها أو رؤية بقية ملاحظاتك.</p>';
      els.shareActions.innerHTML =
        '<button class="btn btn--danger-ghost" type="button" data-share-action="revoke"' + disabled + '>إلغاء الرابط</button>' +
        '<button class="btn btn--ghost" type="button" data-share-action="close">إغلاق</button>';
      els.shareMeta.textContent = 'الرابط صالح لمدة 7 أيام';
      return;
    }

    if (state.shareStatus && state.shareStatus.isActive) {
      var activeExpires = formatDateTime(state.shareStatus.expiresAt);
      els.shareState.innerHTML =
        '<div class="share-status share-status--active">' +
          '<span class="share-status__icon" aria-hidden="true">' + icon('link') + '</span>' +
          '<div><strong>الرابط نشط</strong><p>ينتهي في ' + esc(activeExpires) + '.</p></div>' +
        '</div>' +
        '<div class="info-card info-card--warning">' +
          '<span class="info-card__icon" aria-hidden="true">' + icon('shield') + '</span>' +
          '<div><strong>الرابط محمي</strong><p>لأسباب أمنية لا يمكن عرض الرابط مرة أخرى بعد إغلاق النافذة. إنشاء رابط جديد يلغي الرابط الحالي فوراً.</p></div>' +
        '</div>';
      els.shareActions.innerHTML =
        '<button class="btn btn--danger-ghost" type="button" data-share-action="revoke"' + disabled + '>إلغاء الرابط</button>' +
        '<button class="btn btn--primary" type="button" data-share-action="create"' + disabled + '>إنشاء رابط جديد</button>' +
        '<button class="btn btn--ghost" type="button" data-share-action="close">إغلاق</button>';
      els.shareMeta.textContent = activeExpires ? 'ينتهي ' + activeExpires : 'الرابط نشط';
      return;
    }

    var previous = state.shareStatus
      ? 'انتهت صلاحية الرابط السابق أو تم إلغاؤه.'
      : 'لم تشارك هذه الملاحظة بعد.';

    els.shareState.innerHTML =
      '<div class="share-status share-status--inactive">' +
        '<span class="share-status__icon" aria-hidden="true">' + icon('link-off') + '</span>' +
        '<div><strong>لا يوجد رابط نشط</strong><p>' + esc(previous) + '</p></div>' +
      '</div>' +
      '<div class="info-card">' +
        '<span class="info-card__icon" aria-hidden="true">' + icon('info') + '</span>' +
        '<div><strong>رابط للقراءة فقط</strong><p>يُظهر اسمك ومحتوى الملاحظة فقط، ويظل صالحاً لمدة 7 أيام. يمكنك إلغاؤه في أي وقت.</p></div>' +
      '</div>';
    els.shareActions.innerHTML =
      '<button class="btn btn--primary" type="button" data-share-action="create"' + disabled + '>إنشاء رابط مشاركة</button>' +
      '<button class="btn btn--ghost" type="button" data-share-action="close">إغلاق</button>';
    els.shareMeta.textContent = 'صالح لمدة 7 أيام';
  }

  async function loadShareStatus() {
    if (!state.shareNoteId) return;

    state.shareLoading = true;
    renderShareState();

    try {
      state.shareStatus = await window.HNStore.getShareStatus(state.shareNoteId);
    } catch (error) {
      state.shareStatus = null;
      showAlert(els.shareAlert, window.HNStore.errorMessage(error));
    } finally {
      state.shareLoading = false;
      renderShareState();
    }
  }

  function openShareModal(noteId) {
    if (!state.user) return;
    if (state.user.isDemo) {
      toast('المشاركة غير متاحة في الحساب التجريبي.', { type: 'info', duration: 3800 });
      return;
    }

    var note = getNote(noteId);
    if (!note) return;

    closeNoteMenu();
    state.shareNoteId = noteId;
    state.shareStatus = null;
    state.shareToken = '';
    state.shareLink = '';
    state.shareLoading = true;
    state.shareBusy = false;
    hideAlert(els.shareAlert);
    renderSharePreview(note);
    renderShareState();
    openOverlay(els.shareOverlay);
    loadShareStatus();
  }

  function closeShareModal() {
    closeOverlay(els.shareOverlay);
    resetShareState();
  }

  async function doCreateShare() {
    if (state.shareBusy || !state.shareNoteId) return;

    state.shareBusy = true;
    hideAlert(els.shareAlert);
    renderShareState();

    try {
      var result = await window.HNStore.createShare(state.shareNoteId);
      state.shareToken = result.token;
      state.shareLink = buildShareUrl(result.token);
      state.shareStatus = {
        id: result.shareId,
        createdAt: Date.now(),
        expiresAt: result.expiresAt,
        isActive: true
      };
      invalidateActivity();
      renderShareState();

      setTimeout(function () {
        var input = document.getElementById('shareLinkInput');
        if (input) {
          try {
            input.focus({ preventScroll: true });
            input.select();
          } catch (error) {}
        }
      }, reducedMotion ? 0 : 90);
    } catch (error) {
      showAlert(els.shareAlert, window.HNStore.errorMessage(error));
    } finally {
      state.shareBusy = false;
      renderShareState();
    }
  }

  function createShareLink() {
    if (state.shareBusy) return;

    if (state.shareStatus && state.shareStatus.isActive) {
      openConfirm({
        title: 'إنشاء رابط مشاركة جديد؟',
        message: 'سيتم إلغاء الرابط النشط الحالي فوراً، ولن يعمل بعد ذلك. هل تريد المتابعة؟',
        confirmLabel: 'إنشاء رابط جديد',
        onConfirm: doCreateShare
      });
      return;
    }

    doCreateShare();
  }

  function revokeShareLink() {
    if (state.shareBusy) return;

    var status = state.shareStatus;
    if (!status || !status.id) return;

    openConfirm({
      title: 'إلغاء رابط المشاركة؟',
      message: 'لن يعمل الرابط الحالي بعد الآن. يمكنك إنشاء رابط جديد لاحقاً.',
      confirmLabel: 'إلغاء الرابط',
      onConfirm: async function () {
        state.shareBusy = true;
        hideAlert(els.shareAlert);
        renderShareState();

        try {
          await window.HNStore.revokeShare(status.id);
          state.shareToken = '';
          state.shareLink = '';
          state.shareStatus = {
            id: status.id,
            createdAt: status.createdAt,
            expiresAt: status.expiresAt,
            isActive: false
          };
          invalidateActivity();
          toast('تم إلغاء رابط المشاركة', { type: 'success', duration: 2800 });
        } catch (error) {
          showAlert(els.shareAlert, window.HNStore.errorMessage(error));
        } finally {
          state.shareBusy = false;
          renderShareState();
        }
      }
    });
  }

  function copyShareLink() {
    var link = state.shareLink;
    if (!link) {
      toast('تعذّر نسخ الرابط. أعد إنشاء رابط المشاركة وحاول مرة أخرى.', { type: 'error', duration: 4200 });
      return;
    }

    function success() {
      toast('تم نسخ رابط المشاركة', { type: 'success', duration: 2600 });
    }

    function failure() {
      toast('تعذّر النسخ تلقائياً. حدّد الرابط وانسخه يدوياً.', { type: 'info', duration: 4200 });
    }

    function fallback() {
      var input = document.getElementById('shareLinkInput');
      if (!input) {
        failure();
        return;
      }
      input.focus();
      input.select();
      try {
        if (document.execCommand('copy')) success();
        else failure();
      } catch (error) {
        failure();
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(link).then(success, fallback);
    } else {
      fallback();
    }
  }

  function handleShareAction(action) {
    if (action === 'create') createShareLink();
    else if (action === 'revoke') revokeShareLink();
    else if (action === 'copy') copyShareLink();
    else if (action === 'close') closeShareModal();
  }

  /* ---------- Filters, layout & notes persistence ---------- */
  function persistPrefs() {
    if (!state.user) return;
    state.prefs.layout = state.layout;
    state.prefs.sort = state.sort;
    window.HNStore.savePrefs(state.prefs).catch(function () {});
  }

  function setFilter(type, category) {
    state.filter = { type: type, category: category || null };
    closeNoteMenu();
    closeSidebar();
    setView('notes');
    renderNav();
    renderCategories();
    renderNotesSection();
  }

  function focusSearch() {
    closeNoteMenu();
    if (isSidebarOpen()) closeSidebar();
    setView('notes');
    if (window.innerWidth <= 720) {
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    els.searchInput.focus({ preventScroll: true });
    try { els.searchInput.select(); } catch (error) {}
  }

  function clearSearch(focusAfter) {
    state.query = '';
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    renderNotesSection();
    if (focusAfter) focusSearch();
  }

  function setLayout(layout) {
    state.layout = layout === 'list' ? 'list' : 'grid';
    persistPrefs();
    syncLayoutButtons();
    renderNotesSection();
  }

  async function commitNotes(nextNotes, options) {
    options = options || {};
    if (!state.user) return false;

    var previous = state.notes;
    state.notes = nextNotes;
    if (options.render !== false) renderAll();

    try {
      await window.HNStore.saveNotes(previous, nextNotes);
    } catch (error) {
      state.notes = previous;
      if (options.render !== false) renderAll();
      toast(window.HNStore.errorMessage(error), { type: 'error', duration: 6000 });
      return false;
    }

    invalidateActivity();
    return true;
  }

  async function toggleNoteFlag(noteId, field) {
    var note = getNote(noteId);
    if (!note) return;

    var next = state.notes.map(function (item) {
      if (item.id !== noteId) return item;
      var copy = Object.assign({}, item);
      copy[field] = !item[field];
      return copy;
    });

    closeNoteMenu();
    if (!(await commitNotes(next))) return;

    var message;
    if (field === 'pinned') message = note.pinned ? 'تم إلغاء تثبيت الملاحظة' : 'تم تثبيت الملاحظة في الأعلى';
    else message = note.favorite ? 'تمت إزالتها من المفضلة' : 'تمت إضافتها إلى المفضلة';
    toast(message, { type: 'success', duration: 2400 });
  }

  async function duplicateNote(noteId) {
    var note = getNote(noteId);
    if (!note) return;

    var copy = window.HNStore.makeNote({
      title: note.title + ' (نسخة)',
      content: note.content,
      category: note.category,
      color: note.color,
      pinned: false,
      favorite: false
    });

    closeNoteMenu();
    if (!(await commitNotes([copy].concat(state.notes)))) return;
    toast('تم إنشاء نسخة من الملاحظة', { type: 'success', duration: 2800 });
  }

  async function deleteNote(noteId) {
    var note = getNote(noteId);
    if (!note) return;

    closeNoteMenu();
    var next = state.notes.filter(function (item) { return item.id !== noteId; });
    if (!(await commitNotes(next))) return;

    toast('تم حذف الملاحظة', {
      type: 'info',
      duration: 7000,
      action: {
        label: 'تراجع',
        onClick: async function () {
          if (getNote(note.id)) return;
          if (await commitNotes([note].concat(state.notes))) {
            toast('تمت استعادة الملاحظة', { type: 'success', duration: 2400 });
          }
        }
      }
    });
  }

  /* ---------- Sidebar ---------- */
  function isSidebarOpen() {
    return els.sidebar.classList.contains('is-open');
  }

  function openSidebar() {
    closeNoteMenu();
    clearTimeout(sidebarTimer);
    els.sidebarOverlay.hidden = false;
    void els.sidebarOverlay.offsetHeight;
    els.sidebarOverlay.classList.add('is-visible');
    els.sidebar.classList.add('is-open');
    document.body.classList.add('has-sidebar');
    els.menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar(immediate) {
    els.sidebar.classList.remove('is-open');
    els.sidebarOverlay.classList.remove('is-visible');
    document.body.classList.remove('has-sidebar');
    if (els.menuBtn) els.menuBtn.setAttribute('aria-expanded', 'false');
    clearTimeout(sidebarTimer);
    if (immediate) {
      els.sidebarOverlay.hidden = true;
    } else {
      sidebarTimer = setTimeout(function () {
        if (!els.sidebar.classList.contains('is-open')) els.sidebarOverlay.hidden = true;
      }, reducedMotion ? 0 : 230);
    }
  }

  /* ---------- Note menu ---------- */
  function closeNoteMenu(restoreFocus) {
    if (!els.noteMenu || els.noteMenu.hidden) return;
    var button = state.menuButton;
    els.noteMenu.hidden = true;
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) {
        try { button.focus({ preventScroll: true }); } catch (error) {}
      }
    }
    state.menuButton = null;
    state.menuNoteId = null;
  }

  function openNoteMenu(noteId, button) {
    var note = getNote(noteId);
    if (!note) return;

    closeNoteMenu();
    state.menuNoteId = noteId;
    state.menuButton = button;

    var pinLabel = els.noteMenu.querySelector('[data-note-action="pin"] span');
    var favoriteLabel = els.noteMenu.querySelector('[data-note-action="favorite"] span');
    if (pinLabel) pinLabel.textContent = note.pinned ? 'إلغاء التثبيت' : 'تثبيت';
    if (favoriteLabel) favoriteLabel.textContent = note.favorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة';

    els.noteMenu.hidden = false;
    var rect = button.getBoundingClientRect();
    var width = els.noteMenu.offsetWidth;
    var height = els.noteMenu.offsetHeight;
    var left = rect.right - width;
    var top = rect.bottom + 6;

    if (top + height > window.innerHeight - 8) top = rect.top - height - 6;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    top = Math.max(8, top);

    els.noteMenu.style.left = left + 'px';
    els.noteMenu.style.top = top + 'px';
    button.setAttribute('aria-expanded', 'true');

    setTimeout(function () {
      var first = els.noteMenu.querySelector('[data-note-action]');
      if (first) {
        try { first.focus({ preventScroll: true }); } catch (error) {}
      }
    }, 20);
  }

  function handleNoteMenuAction(action) {
    var noteId = state.menuNoteId;
    if (!noteId) return;

    if (action === 'edit') {
      closeNoteMenu();
      openEditor(getNote(noteId));
    } else if (action === 'share') {
      openShareModal(noteId);
    } else if (action === 'pin') {
      toggleNoteFlag(noteId, 'pinned');
    } else if (action === 'favorite') {
      toggleNoteFlag(noteId, 'favorite');
    } else if (action === 'duplicate') {
      duplicateNote(noteId);
    } else if (action === 'delete') {
      deleteNote(noteId);
    }
  }

  /* ---------- Editor ---------- */
  function setEditorColor(color) {
    state.editorColor = NOTE_COLORS.indexOf(color) !== -1 ? color : 'default';
    $$('.swatch', els.colorSwatches).forEach(function (swatch) {
      var active = swatch.getAttribute('data-color') === state.editorColor;
      swatch.classList.toggle('is-active', active);
      swatch.setAttribute('aria-pressed', String(active));
    });
  }

  function updateEditorWordCount() {
    var text = (els.noteTitle.value + ' ' + els.noteContent.value).trim();
    var words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    els.wordCount.textContent = formatNumber(words) + ' كلمة';
  }

  function editorSnapshot() {
    return JSON.stringify({
      title: els.noteTitle.value,
      content: els.noteContent.value,
      category: els.noteCategory.value,
      color: state.editorColor,
      pinned: els.notePinned.checked,
      favorite: els.noteFavorite.checked
    });
  }

  function editorIsDirty() {
    return editorSnapshot() !== state.editorSnapshot;
  }

  function openEditor(note) {
    if (!state.user) return;
    closeNoteMenu();
    closeSidebar();
    setView('notes');

    state.editingId = note ? note.id : null;
    var defaultCategory = state.filter.type === 'category' ? state.filter.category : 'general';
    var categoryId = note && CATEGORY_MAP[note.category] ? note.category : defaultCategory;
    var color = note && NOTE_COLORS.indexOf(note.color) !== -1
      ? note.color
      : (DEFAULT_NOTE_COLORS[categoryId] || 'default');

    els.noteTitle.value = note ? note.title : '';
    els.noteContent.value = note ? note.content : '';
    els.noteCategory.value = categoryId || 'general';
    els.notePinned.checked = note ? !!note.pinned : false;
    els.noteFavorite.checked = note ? !!note.favorite : false;
    els.noteTitleError.hidden = true;
    els.noteTitleError.textContent = '';
    var titleField = els.noteTitle.closest('.field');
    if (titleField) titleField.classList.remove('has-error');

    setEditorColor(color);
    els.editorTitleLabel.textContent = note ? 'تعديل الملاحظة' : 'ملاحظة جديدة';
    var saveLabel = els.saveNoteBtn.querySelector('.btn__label');
    if (saveLabel) saveLabel.textContent = note ? 'حفظ التغييرات' : 'حفظ الملاحظة';
    els.editorMeta.textContent = note
      ? 'آخر تحديث ' + timeAgo(note.updatedAt)
      : 'ستُحفظ الملاحظة في حسابك';

    updateEditorWordCount();
    state.editorSnapshot = editorSnapshot();
    openOverlay(els.editorOverlay, els.noteTitle);
  }

  function requestCloseEditor(force) {
    if (els.editorOverlay.hidden) return;
    if (!force && editorIsDirty()) {
      openConfirm({
        title: 'تجاهل التغييرات غير المحفوظة؟',
        message: 'لديك تغييرات لم تُحفظ بعد. إذا أغلقت المحرر الآن ستفقدها.',
        confirmLabel: 'تجاهل التغييرات',
        cancelLabel: 'متابعة التحرير',
        onConfirm: function () {
          closeOverlay(els.editorOverlay);
        }
      });
      return;
    }
    closeOverlay(els.editorOverlay);
  }

  async function saveCurrentNote() {
    if (state.savingNote || !state.user) return;

    var title = els.noteTitle.value.trim();
    if (!title) {
      showFieldError(els.noteTitle, 'يرجى إدخال عنوان للملاحظة.');
      els.noteTitle.focus();
      return;
    }
    clearFieldError(els.noteTitle);

    state.savingNote = true;
    setFormLoading(els.saveNoteBtn, true);
    try {
      var wasNew = !state.editingId;
      var now = Date.now();
      var next;

      if (wasNew) {
        var note = window.HNStore.makeNote({
          title: title,
          content: els.noteContent.value,
          category: els.noteCategory.value,
          color: state.editorColor,
          pinned: els.notePinned.checked,
          favorite: els.noteFavorite.checked
        });
        next = [note].concat(state.notes);
      } else {
        next = state.notes.map(function (item) {
          if (item.id !== state.editingId) return item;
          return Object.assign({}, item, {
            title: title,
            content: els.noteContent.value,
            category: CATEGORY_MAP[els.noteCategory.value] ? els.noteCategory.value : 'general',
            color: state.editorColor,
            pinned: els.notePinned.checked,
            favorite: els.noteFavorite.checked,
            updatedAt: now
          });
        });
      }

      if (!(await commitNotes(next, { render: false }))) return;

      if (wasNew) {
        state.filter = { type: 'all', category: null };
        state.query = '';
        els.searchInput.value = '';
        els.searchClear.hidden = true;
      }

      closeOverlay(els.editorOverlay, true);
      renderAll();
      toast(wasNew ? 'تم حفظ الملاحظة الجديدة' : 'تم حفظ التغييرات', {
        type: 'success',
        duration: 2800
      });
    } finally {
      state.savingNote = false;
      setFormLoading(els.saveNoteBtn, false);
    }
  }

  /* ---------- Confirmation ---------- */
  function openConfirm(config) {
    state.confirmConfig = config || {};
    state.confirmRequired = config && config.requireText ? String(config.requireText) : '';

    els.confirmTitle.textContent = (config && config.title) || 'تأكيد الإجراء';
    els.confirmMessage.textContent = (config && config.message) || '';
    els.confirmAccept.textContent = (config && config.confirmLabel) || 'تأكيد';
    els.confirmCancel.textContent = (config && config.cancelLabel) || 'إلغاء';
    els.confirmIcon.classList.toggle('confirm__icon--info', !!(config && config.info));
    els.confirmIcon.innerHTML = icon(config && config.info ? 'info' : 'alert');

    if (state.confirmRequired) {
      els.confirmInputWrap.hidden = false;
      els.confirmInputLabel.textContent = 'اكتب «' + state.confirmRequired + '» للتأكيد';
      els.confirmInput.value = '';
      els.confirmAccept.disabled = true;
      openOverlay(els.confirmOverlay, els.confirmInput);
    } else {
      els.confirmInputWrap.hidden = true;
      els.confirmAccept.disabled = false;
      openOverlay(els.confirmOverlay, els.confirmCancel);
    }
  }

  function cancelConfirm() {
    closeOverlay(els.confirmOverlay);
    state.confirmConfig = null;
    state.confirmRequired = '';
  }

  function acceptConfirm() {
    var config = state.confirmConfig;
    if (!config) return;
    if (state.confirmRequired && els.confirmInput.value.trim() !== state.confirmRequired) return;

    closeOverlay(els.confirmOverlay);
    state.confirmConfig = null;
    state.confirmRequired = '';

    if (typeof config.onConfirm === 'function') {
      try {
        var result = config.onConfirm();
        if (result && result.catch) {
          result.catch(function (error) {
            toast(error && error.message ? error.message : 'تعذّر إتمام الإجراء.', { type: 'error' });
          });
        }
      } catch (error) {
        toast(error && error.message ? error.message : 'تعذّر إتمام الإجراء.', { type: 'error' });
      }
    }
  }

  /* ---------- Settings ---------- */
  function setSettingsTab(tab) {
    state.settingsTab = tab;
    $$('.settings-tab').forEach(function (button) {
      var active = button.getAttribute('data-settings-tab') === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $$('.settings-panel').forEach(function (panel) {
      var active = panel.id === 'panel-' + tab;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    if (tab === 'data') renderStorage();
  }

  function updateAvatarColorSelection() {
    $$('.avatar-color', els.avatarColors).forEach(function (button) {
      var active = button.getAttribute('data-avatar') === state.selectedAvatar;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function updateProfilePreview() {
    if (!state.user) return;
    var name = els.accountName.value.trim() || state.user.name;
    els.profileNamePreview.textContent = name;
    setAvatarAppearance(els.profileAvatar, name, state.selectedAvatar, 'avatar--lg');
  }

  function resetPasswordToggles(scope) {
    $$('[data-toggle-password]', scope).forEach(function (button) {
      var input = document.getElementById(button.getAttribute('data-toggle-password'));
      if (input) setPasswordToggle(button, input, false);
    });
  }

  function openSettings(tab) {
    if (!state.user) return;
    closeNoteMenu();
    closeSidebar();

    state.selectedAvatar = state.user.avatarColor || 'emerald';
    els.accountName.value = state.user.name;
    els.accountEmail.value = state.user.email;
    els.profileNamePreview.textContent = state.user.name;
    els.profileEmailView.textContent = state.user.email;
    els.memberSince.textContent = formatMemberSince(state.user.createdAt);
    updateAvatarColorSelection();
    updateProfilePreview();

    clearFormErrors(els.accountForm);
    clearFieldError(els.accountName);
    els.passwordForm.reset();
    clearFormErrors(els.passwordForm);
    clearFieldError(els.currentPassword);
    clearFieldError(els.newPassword);
    clearFieldError(els.confirmNewPassword);
    updateStrength(els.newPasswordStrength, '');
    resetPasswordToggles(els.passwordForm);

    setFormLoading(els.saveAccountBtn, false);
    setFormLoading(els.updatePasswordBtn, false);
    setFormLoading(els.exportBtn, false);
    setFormLoading(els.importBtn, false);

    setSettingsTab(tab || state.settingsTab || 'account');
    syncThemeControls();
    renderStorage();
    openOverlay(els.settingsOverlay);
  }

  function closeSettings() {
    closeOverlay(els.settingsOverlay);
  }

  async function saveAccountProfile(event) {
    event.preventDefault();
    if (!state.user) return;

    var name = els.accountName.value.trim();
    clearFieldError(els.accountName);
    if (name.length < 2) {
      showFieldError(els.accountName, 'يرجى إدخال اسم مكوّن من حرفين على الأقل.');
      els.accountName.focus();
      return;
    }

    setFormLoading(els.saveAccountBtn, true);
    try {
      var updated = await window.HNStore.updateProfile({
        name: name,
        avatarColor: state.selectedAvatar
      });
      state.user = updated;
      renderUser();
      updateGreeting();
      els.profileNamePreview.textContent = updated.name;
      els.profileEmailView.textContent = updated.email;
      els.memberSince.textContent = formatMemberSince(updated.createdAt);
      updateProfilePreview();
      invalidateActivity();
      toast('تم تحديث معلومات الحساب', { type: 'success', duration: 2800 });
    } catch (error) {
      if (error && error.code === 'invalid-name') showFieldError(els.accountName, error.message);
      else toast(window.HNStore.errorMessage(error), { type: 'error' });
    } finally {
      setFormLoading(els.saveAccountBtn, false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    if (!state.user) return;
    if (state.user.isDemo) {
      toast('هذا حساب تجريبي مشترك، ولا يمكن تغيير كلمة مروره.', { type: 'info', duration: 4200 });
      return;
    }

    clearFieldError(els.currentPassword);
    clearFieldError(els.newPassword);
    clearFieldError(els.confirmNewPassword);

    var current = els.currentPassword.value;
    var nextPassword = els.newPassword.value;
    var confirmation = els.confirmNewPassword.value;
    var firstInvalid = null;

    if (!current) {
      showFieldError(els.currentPassword, 'أدخل كلمة المرور الحالية.');
      firstInvalid = firstInvalid || els.currentPassword;
    }
    if (nextPassword.length < 8) {
      showFieldError(els.newPassword, 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.');
      firstInvalid = firstInvalid || els.newPassword;
    } else if (nextPassword === current) {
      showFieldError(els.newPassword, 'يجب أن تكون كلمة المرور الجديدة مختلفة عن الحالية.');
      firstInvalid = firstInvalid || els.newPassword;
    }
    if (!confirmation) {
      showFieldError(els.confirmNewPassword, 'أعد إدخال كلمة المرور الجديدة.');
      firstInvalid = firstInvalid || els.confirmNewPassword;
    } else if (confirmation !== nextPassword) {
      showFieldError(els.confirmNewPassword, 'كلمتا المرور غير متطابقتين.');
      firstInvalid = firstInvalid || els.confirmNewPassword;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setFormLoading(els.updatePasswordBtn, true);
    try {
      await window.HNStore.changePassword(current, nextPassword);
      els.passwordForm.reset();
      updateStrength(els.newPasswordStrength, '');
      resetPasswordToggles(els.passwordForm);
      invalidateActivity();
      toast('تم تحديث كلمة المرور بنجاح', { type: 'success', duration: 3000 });
    } catch (error) {
      if (error && error.code === 'wrong-password') {
        showFieldError(els.currentPassword, error.message);
        els.currentPassword.focus();
      } else if (error && error.code === 'weak-password') {
        showFieldError(els.newPassword, error.message);
        els.newPassword.focus();
      } else {
        toast(window.HNStore.errorMessage(error), { type: 'error' });
      }
    } finally {
      setFormLoading(els.updatePasswordBtn, false);
    }
  }

  /* ---------- Export / import ---------- */
  function exportNotes() {
    if (!state.user) return;
    try {
      var payload = window.HNStore.exportData(state.user, state.notes);
      var json = JSON.stringify(payload, null, 2);
      var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      var date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = 'important-notes-' + date + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      toast('تم تصدير النسخة الاحتياطية', { type: 'success', duration: 3000 });
    } catch (error) {
      toast('تعذّر تصدير البيانات. حاول مرة أخرى.', { type: 'error' });
    }
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('تعذّر قراءة الملف.')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  async function importNotesFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast('حجم الملف كبير جداً. الحد الأقصى 10 ميجابايت.', { type: 'error' });
      els.importInput.value = '';
      return;
    }

    setFormLoading(els.importBtn, true);
    try {
      var text = await readFileText(file);
      var imported = window.HNStore.parseImport(text);
      var next = imported.concat(state.notes);
      if (!(await commitNotes(next))) return;
      renderStorage();
      toast('تم استيراد ' + notesPhraseObject(imported.length) + ' بنجاح', {
        type: 'success',
        duration: 4200
      });
    } catch (error) {
      toast(error && error.message ? error.message : 'تعذّر استيراد الملف.', { type: 'error', duration: 5000 });
    } finally {
      setFormLoading(els.importBtn, false);
      els.importInput.value = '';
    }
  }

  function deleteAllNotes() {
    if (!state.notes.length) {
      toast('لا توجد ملاحظات لحذفها.', { type: 'info', duration: 2600 });
      return;
    }

    var previous = state.notes.slice();
    openConfirm({
      title: 'حذف جميع الملاحظات؟',
      message: 'سيتم حذف ' + notesPhraseObject(previous.length) + ' من حسابك. يمكنك التراجع خلال ثوانٍ بعد الحذف.',
      confirmLabel: 'حذف الكل',
      onConfirm: async function () {
        if (!(await commitNotes([]))) return;
        renderStorage();
        toast('تم حذف جميع الملاحظات', {
          type: 'info',
          duration: 7000,
          action: {
            label: 'تراجع',
            onClick: async function () {
              var existingIds = new Set(state.notes.map(function (note) { return note.id; }));
              var restored = previous.filter(function (note) { return !existingIds.has(note.id); }).concat(state.notes);
              if (await commitNotes(restored)) {
                toast('تمت استعادة الملاحظات', { type: 'success', duration: 2600 });
              }
            }
          }
        });
      }
    });
  }

  function deleteAccount() {
    if (!state.user) return;
    if (state.user.isDemo) {
      toast('هذا حساب تجريبي مشترك، ولا يمكن حذفه.', { type: 'info', duration: 4200 });
      return;
    }
    openConfirm({
      title: 'حذف الحساب نهائياً؟',
      message: 'سيتم حذف حسابك وجميع ملاحظاتك من قاعدة البيانات نهائياً. لا يمكن التراجع عن هذا الإجراء.',
      confirmLabel: 'حذف الحساب',
      requireText: 'حذف',
      onConfirm: async function () {
        try {
          await window.HNStore.deleteAccount();
          closeAllOverlays();
          closeSidebar(true);
          showAuth();
          toast('تم حذف الحساب وكل بياناته', { type: 'success', duration: 5000 });
        } catch (error) {
          toast(window.HNStore.errorMessage(error), { type: 'error' });
        }
      }
    });
  }

  async function handleLogout() {
    var email = state.user ? state.user.email : '';
    await window.HNStore.signOut();
    closeAllOverlays();
    closeNoteMenu();
    closeSidebar(true);
    showAuth();
    if (email) els.loginEmail.value = email;
    toast('تم تسجيل الخروج بأمان', { type: 'success', duration: 3000 });
  }

  /* ---------- Authentication handlers ---------- */
  async function handleLogin(event) {
    event.preventDefault();
    if (els.loginSubmit.disabled) return;

    clearFormErrors(els.loginForm);
    hideAlert(els.loginAlert);

    var email = els.loginEmail.value.trim();
    var password = els.loginPassword.value;
    var firstInvalid = null;

    if (!email) {
      showFieldError(els.loginEmail, 'يرجى إدخال البريد الإلكتروني.');
      firstInvalid = firstInvalid || els.loginEmail;
    } else if (!EMAIL_RE.test(email)) {
      showFieldError(els.loginEmail, 'أدخل بريداً إلكترونياً صحيحاً.');
      firstInvalid = firstInvalid || els.loginEmail;
    }
    if (!password) {
      showFieldError(els.loginPassword, 'يرجى إدخال كلمة المرور.');
      firstInvalid = firstInvalid || els.loginPassword;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setFormLoading(els.loginSubmit, true);
    try {
      var user = await window.HNStore.signIn(email, password, els.rememberMe.checked);
      els.loginForm.reset();
      els.rememberMe.checked = true;
      await enterApp(user, {
        animate: true,
        toast: 'مرحباً بعودتك، ' + firstName(user.name)
      });
    } catch (error) {
      showAlert(els.loginAlert, window.HNStore.errorMessage(error));
      shake(els.loginForm);
    } finally {
      setFormLoading(els.loginSubmit, false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    if (els.registerSubmit.disabled) return;

    clearFormErrors(els.registerForm);
    hideAlert(els.registerAlert);

    var name = els.registerName.value.trim();
    var email = els.registerEmail.value.trim();
    var password = els.registerPassword.value;
    var confirmation = els.registerConfirm.value;
    var firstInvalid = null;

    if (name.length < 2) {
      showFieldError(els.registerName, 'يرجى إدخال الاسم الكامل.');
      firstInvalid = firstInvalid || els.registerName;
    }
    if (!email) {
      showFieldError(els.registerEmail, 'يرجى إدخال البريد الإلكتروني.');
      firstInvalid = firstInvalid || els.registerEmail;
    } else if (!EMAIL_RE.test(email)) {
      showFieldError(els.registerEmail, 'أدخل بريداً إلكترونياً صحيحاً.');
      firstInvalid = firstInvalid || els.registerEmail;
    }
    if (password.length < 8) {
      showFieldError(els.registerPassword, 'كلمة المرور يجب ألا تقل عن 8 أحرف.');
      firstInvalid = firstInvalid || els.registerPassword;
    }
    if (!confirmation) {
      showFieldError(els.registerConfirm, 'أعد إدخال كلمة المرور للتأكيد.');
      firstInvalid = firstInvalid || els.registerConfirm;
    } else if (confirmation !== password) {
      showFieldError(els.registerConfirm, 'كلمتا المرور غير متطابقتين.');
      firstInvalid = firstInvalid || els.registerConfirm;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setFormLoading(els.registerSubmit, true);
    try {
      var result = await window.HNStore.signUp({
        name: name,
        email: email,
        password: password,
        prefs: {
          theme: document.documentElement.getAttribute('data-theme-mode') || 'system',
          layout: 'grid',
          sort: 'updated-desc'
        }
      });

      els.registerForm.reset();
      updateStrength(els.passwordStrength, '');

      if (result.needsConfirmation) {
        setAuthMode('login');
        els.loginEmail.value = email;
        showAlert(els.loginAlert, 'تم إنشاء حسابك بنجاح. تحقق من بريدك الإلكتروني لتأكيد الحساب، ثم سجّل الدخول.');
        els.loginPassword.focus();
        return;
      }

      await enterApp(result.user, {
        animate: true,
        toast: 'مرحباً ' + firstName(result.user.name) + '، تم إنشاء حسابك بنجاح'
      });
    } catch (error) {
      if (error && error.code === 'email-exists') {
        showFieldError(els.registerEmail, error.message);
        els.registerEmail.focus();
      } else if (error && error.code === 'weak-password') {
        showFieldError(els.registerPassword, error.message);
        els.registerPassword.focus();
      } else if (error && error.code === 'invalid-email') {
        showFieldError(els.registerEmail, error.message);
      } else if (error && error.code === 'invalid-name') {
        showFieldError(els.registerName, error.message);
      } else {
        showAlert(els.registerAlert, window.HNStore.errorMessage(error));
      }
      shake(els.registerForm);
    } finally {
      setFormLoading(els.registerSubmit, false);
    }
  }

  function resetForgotForm() {
    if (!els.forgotForm) return;
    els.forgotForm.reset();
    clearFormErrors(els.forgotForm);
    hideAlert(els.forgotAlert);
    if (els.forgotSuccess) els.forgotSuccess.hidden = true;
    if (els.forgotEmailField) els.forgotEmailField.hidden = false;
    if (els.forgotSubmit) {
      els.forgotSubmit.hidden = false;
      setFormLoading(els.forgotSubmit, false);
    }
  }

  async function handleForgotPassword(event) {
    if (event) event.preventDefault();
    if (!els.forgotForm || els.forgotSubmit.disabled) return;

    var email = els.forgotEmail.value.trim();
    clearFormErrors(els.forgotForm);
    hideAlert(els.forgotAlert);

    if (!email) {
      showFieldError(els.forgotEmail, 'يرجى إدخال البريد الإلكتروني.');
      els.forgotEmail.focus();
      return;
    }
    if (!EMAIL_RE.test(email)) {
      showFieldError(els.forgotEmail, 'أدخل بريداً إلكترونياً صحيحاً.');
      els.forgotEmail.focus();
      return;
    }

    setFormLoading(els.forgotSubmit, true);
    try {
      await window.HNStore.requestPasswordReset(email);
      if (els.forgotEmailField) els.forgotEmailField.hidden = true;
      if (els.forgotSubmit) els.forgotSubmit.hidden = true;
      if (els.forgotSuccess) els.forgotSuccess.hidden = false;
      try { els.forgotCancel.focus(); } catch (error) {}
    } catch (error) {
      if (error && error.code === 'invalid-email') {
        showFieldError(els.forgotEmail, error.message);
        els.forgotEmail.focus();
      } else {
        showAlert(els.forgotAlert, window.HNStore.errorMessage(error));
        shake(els.forgotForm);
      }
    } finally {
      setFormLoading(els.forgotSubmit, false);
    }
  }

  async function handleDemo(event) {
    if (event) event.preventDefault();
    if (els.demoBtn.disabled) return;

    hideAlert(els.loginAlert);
    hideAlert(els.registerAlert);
    setFormLoading(els.demoBtn, true);

    try {
      var user = await window.HNStore.signInDemo();
      await enterApp(user, {
        animate: true,
        toast: 'مرحباً بك في الحساب التجريبي — المشاركة وسجل النشاط معطّلان، وملاحظاتك السبع جاهزة'
      });
    } catch (error) {
      showAlert(els.loginAlert, window.HNStore.errorMessage(error));
    } finally {
      setFormLoading(els.demoBtn, false);
    }
  }

  /* ---------- Note interactions ---------- */
  function handleNotesGridClick(event) {
    var moreButton = event.target.closest('.note__more');
    if (moreButton) {
      event.stopPropagation();
      var menuId = moreButton.getAttribute('data-menu-note');
      if (!els.noteMenu.hidden && state.menuNoteId === menuId) {
        closeNoteMenu(true);
      } else {
        openNoteMenu(menuId, moreButton);
      }
      return;
    }

    var card = event.target.closest('.note');
    if (card) {
      var note = getNote(card.getAttribute('data-note-id'));
      if (note) openEditor(note);
    }
  }

  function handleNotesGridKeydown(event) {
    var card = event.target.closest('.note');
    if (!card || event.target !== card) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      var note = getNote(card.getAttribute('data-note-id'));
      if (note) openEditor(note);
    }
  }

  function handleNoteMenuClick(event) {
    var item = event.target.closest('[data-note-action]');
    if (!item) return;
    handleNoteMenuAction(item.getAttribute('data-note-action'));
  }

  function handleGlobalKeydown(event) {
    var top = topOverlay();

    if (top) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (top === els.editorOverlay) requestCloseEditor();
        else if (top === els.settingsOverlay) closeSettings();
        else if (top === els.confirmOverlay) cancelConfirm();
        else if (top === els.forgotOverlay) closeOverlay(els.forgotOverlay);
        else if (top === els.shareOverlay) closeShareModal();
        return;
      }

      if (event.key === 'Tab') {
        trapFocus(top, event);
        return;
      }

      if (top === els.editorOverlay && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        saveCurrentNote();
        return;
      }
      return;
    }

    if (event.key === 'Escape') {
      if (!els.noteMenu.hidden) {
        closeNoteMenu(true);
        return;
      }
      if (isSidebarOpen()) {
        closeSidebar();
        return;
      }
    }

    if (!state.user) return;

    var target = event.target;
    var tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
    var isEditable = tagName === 'input' || tagName === 'textarea' || tagName === 'select' || (target && target.isContentEditable);

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      focusSearch();
      return;
    }

    if (!isEditable && event.key === '/') {
      event.preventDefault();
      focusSearch();
      return;
    }

    if (!isEditable && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openEditor(null);
    }
  }

  function handleThemeMediaChange() {
    var mode = document.documentElement.getAttribute('data-theme-mode') || 'system';
    if (mode === 'system') {
      document.documentElement.setAttribute('data-theme', effectiveTheme('system'));
      syncThemeControls();
    }
  }

  /* ---------- Event binding ---------- */
  function bindAuthFieldReset(form, alert) {
    if (!form) return;
    form.addEventListener('input', function (event) {
      var input = event.target.closest('.input');
      if (input) clearFieldError(input);
      hideAlert(alert);
    });
  }

  function handleAuthTabKeydown(event) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) === -1) return;
    event.preventDefault();
    var targetMode;
    if (event.key === 'Home') targetMode = 'login';
    else if (event.key === 'End') targetMode = 'register';
    else targetMode = document.activeElement === els.tabLogin ? 'register' : 'login';
    setAuthMode(targetMode);
    (targetMode === 'login' ? els.tabLogin : els.tabRegister).focus();
  }

  function handleDocumentClick(event) {
    var toggle = event.target.closest('[data-toggle-password]');
    if (toggle) {
      var input = document.getElementById(toggle.getAttribute('data-toggle-password'));
      if (input) setPasswordToggle(toggle, input, input.type === 'password');
      return;
    }

    if (!els.noteMenu.hidden && !els.noteMenu.contains(event.target)) {
      closeNoteMenu();
    }
  }

  function handleWindowScroll() {
    if (!els.noteMenu.hidden) closeNoteMenu();
  }

  function handleWindowResize() {
    if (!els.noteMenu.hidden) closeNoteMenu();
    if (window.innerWidth > 1024 && isSidebarOpen()) closeSidebar(true);
  }

  function handleSettingsTabKeydown(event) {
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) === -1) return;
    var tabs = $$('.settings-tab');
    var currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex === -1) return;
    event.preventDefault();

    var nextIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') nextIndex = (currentIndex + 1) % tabs.length;
    else nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;

    var tab = tabs[nextIndex];
    setSettingsTab(tab.getAttribute('data-settings-tab'));
    tab.focus();
  }

  function bindEvents() {
    /* Auth */
    els.tabLogin.addEventListener('click', function () { setAuthMode('login'); });
    els.tabRegister.addEventListener('click', function () { setAuthMode('register'); });
    els.tabLogin.addEventListener('keydown', handleAuthTabKeydown);
    els.tabRegister.addEventListener('keydown', handleAuthTabKeydown);
    els.loginForm.addEventListener('submit', handleLogin);
    els.registerForm.addEventListener('submit', handleRegister);
    els.demoBtn.addEventListener('click', handleDemo);
    els.authThemeToggle.addEventListener('click', toggleTheme);

    bindAuthFieldReset(els.loginForm, els.loginAlert);
    bindAuthFieldReset(els.registerForm, els.registerAlert);
    els.registerPassword.addEventListener('input', function () {
      updateStrength(els.passwordStrength, els.registerPassword.value);
    });

    els.forgotBtn.addEventListener('click', function () {
      resetForgotForm();
      openOverlay(els.forgotOverlay, els.forgotEmail);
    });
    els.forgotForm.addEventListener('submit', handleForgotPassword);
    bindAuthFieldReset(els.forgotForm, els.forgotAlert);
    els.forgotCancel.addEventListener('click', function () {
      closeOverlay(els.forgotOverlay);
    });
    els.forgotOverlay.addEventListener('click', function (event) {
      if (event.target === els.forgotOverlay) closeOverlay(els.forgotOverlay);
    });

    /* Sidebar */
    els.menuBtn.addEventListener('click', openSidebar);
    els.sidebarClose.addEventListener('click', function () { closeSidebar(); });
    els.sidebarOverlay.addEventListener('click', function () { closeSidebar(); });
    els.brandHome.addEventListener('click', function (event) {
      event.preventDefault();
      closeSidebar();
      clearSearch(false);
      setFilter('all');
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    });

    /* Navigation */
    $$('.nav-item[data-filter]').forEach(function (button) {
      button.addEventListener('click', function () {
        setFilter(button.getAttribute('data-filter'));
      });
    });
    els.categoryNav.addEventListener('click', function (event) {
      var button = event.target.closest('[data-category]');
      if (!button) return;
      setFilter('category', button.getAttribute('data-category'));
    });

    if (els.activityNavBtn) {
      els.activityNavBtn.addEventListener('click', showActivityView);
    }
    if (els.activityBackBtn) {
      els.activityBackBtn.addEventListener('click', showNotesView);
    }
    if (els.activityRefreshBtn) {
      els.activityRefreshBtn.addEventListener('click', function () { loadActivity(true); });
    }
    if (els.activityRetryBtn) {
      els.activityRetryBtn.addEventListener('click', function () { loadActivity(true); });
    }
    if (els.activityMoreBtn) {
      els.activityMoreBtn.addEventListener('click', function () { loadActivity(false); });
    }

    /* Topbar & notes toolbar */
    els.newNoteBtn.addEventListener('click', function () { openEditor(null); });
    els.newNoteTop.addEventListener('click', function () { openEditor(null); });
    els.emptyAction.addEventListener('click', function () {
      if (typeof state.emptyAction === 'function') state.emptyAction();
    });
    els.topbarProfile.addEventListener('click', function () { openSettings('account'); });
    els.openSettingsBtn.addEventListener('click', function () { openSettings('account'); });
    els.settingsBtn.addEventListener('click', function () { openSettings('account'); });
    els.logoutBtn.addEventListener('click', handleLogout);
    els.topbarTheme.addEventListener('click', toggleTheme);

    els.searchInput.addEventListener('input', function () {
      state.query = els.searchInput.value;
      els.searchClear.hidden = !state.query;
      setView('notes');
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { renderNotesSection(); }, 120);
    });
    els.searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        clearSearch(true);
      }
    });
    els.searchClear.addEventListener('click', function () { clearSearch(true); });

    els.sortSelect.addEventListener('change', function () {
      state.sort = els.sortSelect.value;
      persistPrefs();
      renderNotesSection();
    });
    els.gridViewBtn.addEventListener('click', function () { setLayout('grid'); });
    els.listViewBtn.addEventListener('click', function () { setLayout('list'); });

    els.notesGrid.addEventListener('click', handleNotesGridClick);
    els.notesGrid.addEventListener('keydown', handleNotesGridKeydown);
    els.noteMenu.addEventListener('click', handleNoteMenuClick);

    /* Editor */
    els.editorForm.addEventListener('submit', function (event) {
      event.preventDefault();
      saveCurrentNote();
    });
    $$('[data-close-editor]').forEach(function (button) {
      button.addEventListener('click', function () { requestCloseEditor(); });
    });
    els.editorOverlay.addEventListener('click', function (event) {
      if (event.target === els.editorOverlay) requestCloseEditor();
    });
    els.noteContent.addEventListener('input', updateEditorWordCount);
    els.noteTitle.addEventListener('input', function () {
      updateEditorWordCount();
      clearFieldError(els.noteTitle);
    });
    els.noteCategory.addEventListener('change', function () {
      // Keep user's chosen color; category only affects organization.
    });
    els.colorSwatches.addEventListener('click', function (event) {
      var swatch = event.target.closest('[data-color]');
      if (swatch) setEditorColor(swatch.getAttribute('data-color'));
    });

    /* Settings */
    $$('[data-close-settings]').forEach(function (button) {
      button.addEventListener('click', closeSettings);
    });
    els.settingsOverlay.addEventListener('click', function (event) {
      if (event.target === els.settingsOverlay) closeSettings();
    });
    $$('.settings-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        setSettingsTab(tab.getAttribute('data-settings-tab'));
      });
    });
    $('.settings__tabs').addEventListener('keydown', handleSettingsTabKeydown);

    els.accountForm.addEventListener('submit', saveAccountProfile);
    els.accountForm.addEventListener('input', function (event) {
      var input = event.target.closest('.input');
      if (input) clearFieldError(input);
      if (event.target === els.accountName) updateProfilePreview();
    });
    els.avatarColors.addEventListener('click', function (event) {
      var button = event.target.closest('[data-avatar]');
      if (!button) return;
      state.selectedAvatar = button.getAttribute('data-avatar');
      updateAvatarColorSelection();
      updateProfilePreview();
    });

    els.passwordForm.addEventListener('submit', changePassword);
    els.passwordForm.addEventListener('input', function (event) {
      var input = event.target.closest('.input');
      if (input) clearFieldError(input);
      if (event.target === els.newPassword) {
        updateStrength(els.newPasswordStrength, els.newPassword.value);
      }
    });

    els.exportBtn.addEventListener('click', exportNotes);
    els.importBtn.addEventListener('click', function () { els.importInput.click(); });
    els.importInput.addEventListener('change', function () {
      var file = els.importInput.files && els.importInput.files[0];
      if (file) importNotesFile(file);
    });
    els.deleteAllBtn.addEventListener('click', deleteAllNotes);
    els.deleteAccountBtn.addEventListener('click', deleteAccount);

    els.themeOptions.addEventListener('change', function (event) {
      if (event.target && event.target.name === 'themeMode') {
        applyTheme(event.target.value, { global: true, user: !!state.user });
      }
    });

    /* Theme */
    els.themeSwitch.addEventListener('change', function () {
      applyTheme(els.themeSwitch.checked ? 'dark' : 'light', {
        global: true,
        user: !!state.user
      });
    });

    /* Share */
    if (els.shareOverlay) {
      els.shareOverlay.addEventListener('click', function (event) {
        if (event.target === els.shareOverlay) {
          closeShareModal();
          return;
        }

        // Actions can live in #shareActions or inside #shareState (the copy
        // button next to the generated link), so delegate from the overlay.
        var button = event.target.closest('[data-share-action]');
        if (!button) return;
        handleShareAction(button.getAttribute('data-share-action'));
      });
      $$('[data-close-share]').forEach(function (button) {
        button.addEventListener('click', closeShareModal);
      });
    }

    /* Confirm & forgot */
    els.confirmCancel.addEventListener('click', cancelConfirm);
    els.confirmAccept.addEventListener('click', acceptConfirm);
    els.confirmInput.addEventListener('input', function () {
      if (!state.confirmRequired) return;
      els.confirmAccept.disabled = els.confirmInput.value.trim() !== state.confirmRequired;
    });
    els.confirmInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !els.confirmAccept.disabled) {
        event.preventDefault();
        acceptConfirm();
      }
    });
    els.confirmOverlay.addEventListener('click', function (event) {
      if (event.target === els.confirmOverlay) cancelConfirm();
    });

    /* Global listeners */
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('scroll', handleWindowScroll, true);
    window.addEventListener('resize', handleWindowResize);

    var darkMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (darkMedia) {
      if (typeof darkMedia.addEventListener === 'function') darkMedia.addEventListener('change', handleThemeMediaChange);
      else if (typeof darkMedia.addListener === 'function') darkMedia.addListener(handleThemeMediaChange);
    }
  }

  /* ---------- Boot ---------- */
  async function init() {
    cacheElements();
    buildStaticOptions();
    bindEvents();
    syncThemeControls();

    var problems = [];
    var configured = window.HNStore && typeof window.HNStore.isConfigured === 'function' && window.HNStore.isConfigured();
    if (!configured) {
      problems.push('تعذّر تحميل إعدادات Supabase. تحقق من اتصالك بالإنترنت ثم أعد تحميل الصفحة.');
    }

    var sessionUser = null;
    if (configured) {
      try {
        sessionUser = await window.HNStore.restoreSession();
      } catch (error) {
        problems.push(window.HNStore.errorMessage(error));
      }
    }

    if (sessionUser) await enterApp(sessionUser, { animate: true });
    else showAuth();

    if (problems.length) {
      state.blockedMessage = problems.join(' ');
      showAlert(els.loginAlert, state.blockedMessage);
      showAlert(els.registerAlert, state.blockedMessage);

      if (!configured) {
        els.loginSubmit.disabled = true;
        els.registerSubmit.disabled = true;
        els.demoBtn.disabled = true;
      }
    }

    requestAnimationFrame(function () {
      document.body.classList.remove('is-booting');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
