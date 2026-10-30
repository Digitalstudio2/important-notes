/* ==========================================================================
   مساحة التدوين — Password reset page
   --------------------------------------------------------------------------
   This page uses its own Supabase client because it reads the recovery session
   from the URL manually. The main app keeps detectSessionInUrl disabled so that
   share.html can keep using location.hash for share tokens.
   ========================================================================== */
(function () {
  'use strict';

  var AUTH_STORAGE_KEY = 'hn.auth.session.v1';
  var REMEMBER_KEY = 'hn.remember.v1';

  var els = {};
  var client = null;

  var $ = function (selector) { return document.querySelector(selector); };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function icon(name) {
    return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function getRemember() {
    try {
      return localStorage.getItem(REMEMBER_KEY) !== '0';
    } catch (error) {
      return true;
    }
  }

  function isVerifierKey(key) {
    return /-code-verifier$/.test(String(key || ''));
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
        // Keep the PKCE verifier in localStorage so a recovery link opened in
        // a new tab can still be exchanged for a session.
        if (isVerifierKey(key)) {
          localStorage.setItem(key, value);
          try { sessionStorage.removeItem(key); } catch (error) {}
          return;
        }

        if (getRemember()) {
          localStorage.setItem(key, value);
          try { sessionStorage.removeItem(key); } catch (error) {}
        } else {
          sessionStorage.setItem(key, value);
          try { localStorage.removeItem(key); } catch (error) {}
        }
      } catch (error) {}
    },
    removeItem: function (key) {
      try { localStorage.removeItem(key); } catch (error) {}
      try { sessionStorage.removeItem(key); } catch (error) {}
    }
  };

  function readHashParams() {
    try {
      return new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    } catch (error) {
      return new URLSearchParams('');
    }
  }

  function readUrlState() {
    var state = { recovery: false, error: '', code: '', accessToken: '', refreshToken: '' };
    try {
      var url = new URL(window.location.href);
      var hash = readHashParams();
      var code = url.searchParams.get('code') || '';
      var accessToken = hash.get('access_token') || '';
      var refreshToken = hash.get('refresh_token') || '';
      var type = hash.get('type') || url.searchParams.get('type') || '';
      var errorCode = hash.get('error_code') || url.searchParams.get('error_code') || hash.get('error') || url.searchParams.get('error') || '';
      var errorDescription = hash.get('error_description') || url.searchParams.get('error_description') || '';

      state.code = code;
      state.accessToken = accessToken;
      state.refreshToken = refreshToken;
      state.recovery = !!(code || (accessToken && refreshToken && type === 'recovery'));

      if (errorDescription) {
        if (errorCode === 'otp_expired' || /expired|invalid/i.test(errorDescription)) {
          state.error = 'انتهت صلاحية رابط الاستعادة. اطلب رابطاً جديداً من صفحة تسجيل الدخول.';
        } else {
          state.error = 'تعذّر التحقق من رابط الاستعادة. اطلب رابطاً جديداً من صفحة تسجيل الدخول.';
        }
      } else if (errorCode === 'otp_expired') {
        state.error = 'انتهت صلاحية رابط الاستعادة. اطلب رابطاً جديداً من صفحة تسجيل الدخول.';
      } else if (errorCode) {
        state.error = 'تعذّر التحقق من رابط الاستعادة. اطلب رابطاً جديداً من صفحة تسجيل الدخول.';
      }
    } catch (error) {}
    return state;
  }

  function clearRecoveryUrl() {
    try {
      var url = new URL(window.location.href);
      url.hash = '';
      ['code', 'error', 'error_code', 'error_description', 'token_hash', 'type'].forEach(function (key) {
        url.searchParams.delete(key);
      });
      window.history.replaceState(null, '', url.pathname + url.search);
    } catch (error) {}
  }

  function cacheElements() {
    els.loading = $('#resetLoading');
    els.form = $('#resetForm');
    els.invalid = $('#resetInvalid');
    els.invalidText = $('#resetInvalidText');
    els.success = $('#resetSuccess');
    els.subheading = $('#resetSubheading');
    els.alert = $('#resetAlert');
    els.password = $('#resetPassword');
    els.confirm = $('#resetConfirm');
    els.strength = $('#resetStrength');
    els.submit = $('#resetSubmit');
    els.themeToggle = $('#resetThemeToggle');
    els.back = $('#resetBack');
    els.year = $('#resetYear');
  }

  function showAlert(message) {
    if (!els.alert) return;
    els.alert.innerHTML = icon('alert') + '<span>' + esc(message) + '</span>';
    els.alert.hidden = false;
  }

  function hideAlert() {
    if (!els.alert) return;
    els.alert.hidden = true;
    els.alert.textContent = '';
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

  function clearFormErrors() {
    if (!els.form) return;
    Array.prototype.forEach.call(els.form.querySelectorAll('.field.has-error'), function (field) {
      field.classList.remove('has-error');
    });
    Array.prototype.forEach.call(els.form.querySelectorAll('.field__error'), function (error) {
      error.textContent = '';
      error.hidden = true;
    });
  }

  function shake(element) {
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    element.classList.remove('shake');
    void element.offsetWidth;
    element.classList.add('shake');
  }

  function setFormLoading(loading) {
    if (!els.submit) return;
    els.submit.classList.toggle('is-loading', !!loading);
    els.submit.disabled = !!loading;
    els.submit.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  function passwordScore(password) {
    var score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Za-z]/.test(password) && /\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return Math.min(score, 4);
  }

  function updateStrength(password) {
    if (!els.strength) return;
    var score = password ? passwordScore(password) : 0;
    els.strength.setAttribute('data-level', String(score));
    var label = els.strength.querySelector('.strength__label');
    if (!label) return;
    var labels = ['قوة كلمة المرور', 'ضعيفة', 'متوسطة', 'قوية', 'قوية جداً'];
    label.textContent = labels[score];
  }

  function setState(state) {
    if (els.loading) els.loading.hidden = state !== 'loading';
    if (els.form) els.form.hidden = state !== 'form';
    if (els.invalid) els.invalid.hidden = state !== 'invalid';
    if (els.success) els.success.hidden = state !== 'success';
    if (els.back) els.back.hidden = state !== 'form';
    document.body.classList.remove('is-booting');
  }

  function showInvalid(message) {
    if (els.subheading) els.subheading.textContent = 'تعذّر فتح رابط الاستعادة.';
    if (els.invalidText && message) els.invalidText.textContent = message;
    hideAlert();
    setState('invalid');
  }

  function showForm() {
    if (els.subheading) els.subheading.textContent = 'اختر كلمة مرور جديدة قوية لحسابك.';
    hideAlert();
    setState('form');
    setTimeout(function () {
      try { els.password.focus(); } catch (error) {}
    }, 80);
  }

  function showSuccess() {
    if (els.subheading) els.subheading.textContent = 'تم تحديث كلمة المرور بنجاح.';
    hideAlert();
    setState('success');
  }

  function mapAuthError(error) {
    var message = String((error && (error.message || error.error_description)) || '');
    var code = String((error && error.code) || '');

    if (code === 'weak_password' || /password should be at least/i.test(message)) {
      return 'كلمة المرور قصيرة جداً. استخدم 8 أحرف على الأقل.';
    }
    if (code === 'same_password' || /different from the old password/i.test(message)) {
      return 'اختر كلمة مرور مختلفة عن كلمة المرور السابقة.';
    }
    if (code === 'session_not_found' || code === 'refresh_token_not_found' || /session.*not found|invalid.*session|jwt expired/i.test(message)) {
      return 'انتهت صلاحية الجلسة. اطلب رابط استعادة جديداً.';
    }
    if (code === 'over_request_rate_limit' || /rate limit|too many requests/i.test(message)) {
      return 'تم إرسال عدد كبير من الطلبات. انتظر قليلاً ثم حاول مرة أخرى.';
    }
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
      return 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.';
    }
    return 'تعذّر تحديث كلمة المرور. حاول مرة أخرى.';
  }

  function mapRecoveryError(error) {
    var message = String((error && (error.message || error.error_description)) || '');
    var code = String((error && error.code) || '');

    if (code === 'otp_expired' || code === 'pkce_code_verifier_not_found' ||
        /expired|invalid.*(token|code)|token.*invalid|code verifier/i.test(message)) {
      return 'انتهت صلاحية رابط الاستعادة أو أنه غير صالح. اطلب رابطاً جديداً من صفحة تسجيل الدخول.';
    }
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
      return 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.';
    }
    return 'تعذّر التحقق من رابط الاستعادة. اطلب رابطاً جديداً من صفحة تسجيل الدخول.';
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!client || !els.submit || els.submit.disabled) return;

    var password = els.password.value;
    var confirmation = els.confirm.value;
    clearFormErrors();
    hideAlert();

    var firstInvalid = null;
    if (password.length < 8) {
      showFieldError(els.password, 'كلمة المرور يجب ألا تقل عن 8 أحرف.');
      firstInvalid = firstInvalid || els.password;
    }
    if (!confirmation) {
      showFieldError(els.confirm, 'أعد إدخال كلمة المرور للتأكيد.');
      firstInvalid = firstInvalid || els.confirm;
    } else if (confirmation !== password) {
      showFieldError(els.confirm, 'كلمتا المرور غير متطابقتين.');
      firstInvalid = firstInvalid || els.confirm;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setFormLoading(true);
    try {
      var result = await client.auth.updateUser({ password: password });
      if (result.error) throw result.error;

      // A password reset should invalidate sessions on other devices.
      try { await client.auth.signOut({ scope: 'global' }); } catch (signOutError) {}
      showSuccess();
    } catch (error) {
      var message = mapAuthError(error);
      if (/انتهت صلاحية الجلسة/.test(message)) {
        clearRecoveryUrl();
        showInvalid(message);
      } else {
        showAlert(message);
        shake(els.form);
      }
    } finally {
      setFormLoading(false);
    }
  }

  function bindEvents() {
    if (els.themeToggle) {
      els.themeToggle.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        var next = current === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('hn.theme.v1', next); } catch (error) {}
        document.documentElement.setAttribute('data-theme', next);
        document.documentElement.setAttribute('data-theme-mode', next);
      });
    }

    document.addEventListener('click', function (event) {
      var toggle = event.target.closest('[data-toggle-password]');
      if (!toggle) return;
      var input = document.getElementById(toggle.getAttribute('data-toggle-password'));
      if (!input) return;
      var visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      toggle.classList.toggle('is-visible', visible);
      toggle.setAttribute('aria-label', visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    });

    if (els.form) {
      els.form.addEventListener('submit', handleSubmit);
      els.form.addEventListener('input', function (event) {
        var input = event.target.closest('.input');
        if (input) {
          var field = input.closest('.field');
          if (field) field.classList.remove('has-error');
          var error = field && field.querySelector('.field__error');
          if (error) {
            error.textContent = '';
            error.hidden = true;
          }
        }
        hideAlert();
      });
    }

    if (els.password) {
      els.password.addEventListener('input', function () {
        updateStrength(els.password.value);
      });
    }
  }

  async function boot() {
    cacheElements();
    bindEvents();

    if (els.year) els.year.textContent = String(new Date().getFullYear());

    var urlState = readUrlState();

    if (!window.supabase || typeof window.supabase.createClient !== 'function' ||
        !window.HN_SUPABASE_URL || !window.HN_SUPABASE_PUBLISHABLE_KEY) {
      showInvalid('تعذّر تحميل إعدادات الخدمة. تحقق من اتصالك بالإنترنت ثم أعد تحميل الصفحة.');
      return;
    }

    if (urlState.error) {
      clearRecoveryUrl();
      showInvalid(urlState.error);
      return;
    }

    if (!urlState.recovery) {
      showInvalid('افتح صفحة إعادة التعيين من الرابط المرسل إلى بريدك الإلكتروني، أو اطلب رابطاً جديداً من صفحة تسجيل الدخول.');
      return;
    }

    try {
      client = window.supabase.createClient(window.HN_SUPABASE_URL, window.HN_SUPABASE_PUBLISHABLE_KEY, {
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
      showInvalid('تعذّر الاتصال بخدمة المصادقة. أعد تحميل الصفحة أو اطلب رابطاً جديداً.');
      return;
    }

    var recoveryError = null;
    try {
      if (urlState.code) {
        // PKCE recovery links arrive as ?code=... and must be exchanged with
        // the verifier saved when the reset email was requested.
        var exchange = await client.auth.exchangeCodeForSession(urlState.code);
        recoveryError = exchange.error || (!exchange.data || !exchange.data.session
          ? new Error('no session')
          : null);
      } else {
        // Implicit recovery links arrive as #access_token=...&refresh_token=...
        // and can be adopted directly.
        var adopted = await client.auth.setSession({
          access_token: urlState.accessToken,
          refresh_token: urlState.refreshToken
        });
        recoveryError = adopted.error || (!adopted.data || !adopted.data.session
          ? new Error('no session')
          : null);
      }
    } catch (error) {
      recoveryError = error;
    }

    if (recoveryError) {
      clearRecoveryUrl();
      showInvalid(mapRecoveryError(recoveryError));
      return;
    }

    clearRecoveryUrl();
    showForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
