/* ==========================================================================
   مساحة التدوين — Shared note viewer
   --------------------------------------------------------------------------
   - The token is read from location.hash only, so it is never sent to the
     hosting server (GitHub Pages) in an HTTP request.
   - The page is read-only and renders all note content with textContent.
   - No authentication is required; the database RPC exposes only the shared
     note, its owner's display name, and the owner's avatar color.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (selector) { return document.querySelector(selector); };

  var CATEGORIES = {
    work: { name: 'عمل', color: '#6366f1' },
    personal: { name: 'شخصي', color: '#0f9f6b' },
    study: { name: 'دراسة', color: '#e11d48' },
    ideas: { name: 'أفكار', color: '#d97706' },
    tasks: { name: 'مهام', color: '#0284c7' },
    general: { name: 'عام', color: '#64748b' }
  };

  var AVATAR_COLORS = ['emerald', 'indigo', 'rose', 'amber', 'sky', 'violet'];
  var TOKEN_RE = /^[0-9a-f]{64}$/;

  var els = {
    main: $('#shareMain'),
    skipLink: $('#shareSkipLink'),
    loading: $('#shareLoading'),
    error: $('#shareError'),
    errorTitle: $('#shareErrorTitle'),
    errorText: $('#shareErrorText'),
    retryBtn: $('#shareRetryBtn'),
    card: $('#shareCard'),
    ownerAvatar: $('#shareOwnerAvatar'),
    ownerName: $('#shareOwnerName'),
    category: $('#shareCategory'),
    title: $('#shareTitle'),
    sharedAt: $('#shareSharedAt'),
    expiresAt: $('#shareExpiresAt'),
    content: $('#shareContent')
  };

  var dateFormatter;
  var dateTimeFormatter;

  try {
    dateFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    dateTimeFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
      day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  } catch (error) {
    dateFormatter = dateTimeFormatter = null;
  }

  function toLatinDigits(value) {
    return String(value == null ? '' : value).replace(/[٠-٩]/g, function (digit) {
      return String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
    }).replace(/[۰-۹]/g, function (digit) {
      return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));
    });
  }

  function formatDate(timestamp) {
    var time = Number(timestamp);
    if (!Number.isFinite(time) || time <= 0) return '';
    if (!dateFormatter) return '';
    return toLatinDigits(dateFormatter.format(new Date(time)));
  }

  function formatDateTime(timestamp) {
    var time = Number(timestamp);
    if (!Number.isFinite(time) || time <= 0) return '';
    if (!dateTimeFormatter) return formatDate(timestamp);
    return toLatinDigits(dateTimeFormatter.format(new Date(time)));
  }

  function readToken() {
    var raw = String(window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
    return TOKEN_RE.test(raw) ? raw : '';
  }

  function showLoading() {
    els.loading.hidden = false;
    els.error.hidden = true;
    els.card.hidden = true;
  }

  function showError(title, message, canRetry) {
    els.loading.hidden = true;
    els.card.hidden = true;
    els.error.hidden = false;
    els.errorTitle.textContent = title;
    els.errorText.textContent = message;
    els.retryBtn.hidden = !canRetry;
  }

  function avatarColor(value) {
    return AVATAR_COLORS.indexOf(value) !== -1 ? value : 'emerald';
  }

  function initialOf(name) {
    var clean = String(name || '').trim();
    return clean ? clean.charAt(0) : 'م';
  }

  function renderNote(note) {
    var category = CATEGORIES[note.category] || CATEGORIES.general;
    var ownerName = String(note.ownerName || 'مستخدم').trim() || 'مستخدم';
    var content = String(note.content || '');

    els.ownerAvatar.className = 'avatar avatar--md avatar--' + avatarColor(note.ownerAvatarColor);
    els.ownerAvatar.textContent = initialOf(ownerName);
    els.ownerName.textContent = ownerName;

    els.category.innerHTML = '<i style="background:' + category.color + '"></i><span>' + category.name + '</span>';
    els.title.textContent = note.title || 'بدون عنوان';

    var sharedDate = formatDate(note.sharedAt);
    var expiryDate = formatDateTime(note.expiresAt);
    els.sharedAt.textContent = sharedDate ? 'شُوركت في ' + sharedDate : 'ملاحظة مشتركة';
    els.expiresAt.textContent = expiryDate ? 'تنتهي في ' + expiryDate : 'رابط مؤقت';

    els.content.textContent = content || 'لا يوجد محتوى في هذه الملاحظة.';
    els.content.classList.toggle('is-empty', !content);

    els.loading.hidden = true;
    els.error.hidden = true;
    els.card.hidden = false;
  }

  function load() {
    var token = readToken();

    if (!token) {
      showError(
        'لا يوجد رابط صالح',
        'هذا الرابط لا يحتوي على رمز مشاركة صحيح. اطلب من مالك الملاحظة إرسال الرابط كاملاً.',
        false
      );
      return;
    }

    if (!window.HNStore || typeof window.HNStore.getSharedNote !== 'function') {
      showError(
        'تعذّر تحميل الصفحة',
        'لم تكتمل تهيئة الاتصال. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.',
        true
      );
      return;
    }

    showLoading();

    window.HNStore.getSharedNote(token).then(function (note) {
      if (!note) {
        showError(
          'انتهت صلاحية الرابط',
          'قد يكون هذا الرابط منتهياً أو تم إلغاؤه أو لا يخص ملاحظة موجودة. اطلب رابطاً جديداً من مالك الملاحظة.',
          false
        );
        return;
      }
      renderNote(note);
    }).catch(function (error) {
      showError(
        'تعذّر فتح الملاحظة',
        window.HNStore.errorMessage(error),
        true
      );
    });
  }

  if (els.skipLink && els.main) {
    els.skipLink.addEventListener('click', function () {
      els.main.focus();
    });
  }

  els.retryBtn.addEventListener('click', load);
  window.addEventListener('hashchange', load);
  load();
})();
