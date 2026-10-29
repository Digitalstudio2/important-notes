/* ==========================================================================
   ملاحظات هامة — Password hashing (PBKDF2-SHA256 via Web Crypto)
   ========================================================================== */
(function () {
  'use strict';

  var ITERATIONS = 160000;
  var encoder = new TextEncoder();

  function isSupported() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
  }

  function bytesToBase64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function deriveBits(password, salt, iterations) {
    var keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    var bits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    return new Uint8Array(bits);
  }

  async function hashPassword(password) {
    if (!isSupported()) {
      var error = new Error('متصفحك لا يدعم التشفير الآمن. يرجى استخدام متصفح حديث.');
      error.code = 'unsupported';
      throw error;
    }

    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var hash = await deriveBits(password, salt, ITERATIONS);

    return {
      algorithm: 'PBKDF2-SHA256',
      iterations: ITERATIONS,
      salt: bytesToBase64(salt),
      hash: bytesToBase64(hash)
    };
  }

  async function verifyPassword(password, record) {
    if (!isSupported() || !record || !record.salt || !record.hash) {
      return false;
    }

    try {
      var salt = base64ToBytes(record.salt);
      var expected = base64ToBytes(record.hash);
      var actual = await deriveBits(password, salt, record.iterations || ITERATIONS);

      if (actual.length !== expected.length) return false;

      var diff = 0;
      for (var i = 0; i < actual.length; i++) {
        diff |= actual[i] ^ expected[i];
      }
      return diff === 0;
    } catch (error) {
      return false;
    }
  }

  window.HNHash = {
    isSupported: isSupported,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword
  };
})();
