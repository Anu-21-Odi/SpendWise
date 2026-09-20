/* ==========================================================================
   SpendWise — auth.js
   Deliberately minimal, local-only "sign in".

   There is no backend, so this is a personalisation layer, NOT security:
     • No password is ever stored or transmitted.
     • The profile just lets the app greet you and scope your data.
   Anything here could be cleared by anyone with access to the browser, which is
   exactly why the UI calls it demo mode rather than pretending otherwise.
   ========================================================================== */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  } else {
    root.SpendWiseAuth = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY_PROFILES = 'spendwise_profiles';
  const KEY_SESSION = 'spendwise_session';

  function safeParse(raw, fallback) {
    try {
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function readProfiles() {
    if (typeof localStorage === 'undefined') return {};
    const data = safeParse(localStorage.getItem(KEY_PROFILES), {});
    return (data && typeof data === 'object') ? data : {};
  }

  function writeProfiles(profiles) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY_PROFILES, JSON.stringify(profiles));
  }

  function normaliseEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  /** "Ada Lovelace" -> "AL", "ada" -> "A", "" -> "?" */
  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function makeProfile(name, email) {
    const cleanName = String(name || '').trim() || normaliseEmail(email).split('@')[0] || 'Friend';
    return {
      name: cleanName,
      email: normaliseEmail(email),
      initials: initials(cleanName),
      createdAt: new Date().toISOString()
    };
  }

  /** Create or refresh a profile and start a session. */
  function signIn(input) {
    const email = normaliseEmail(input && input.email);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, error: 'Enter a valid email address.' };
    }

    const profiles = readProfiles();
    const existing = profiles[email];
    const profile = existing
      ? { ...existing, name: (input && input.name && String(input.name).trim()) || existing.name }
      : makeProfile(input && input.name, email);

    profiles[email] = profile;
    writeProfiles(profiles);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY_SESSION, JSON.stringify({ email, signedInAt: new Date().toISOString() }));
    }
    return { ok: true, profile };
  }

  function currentUser() {
    if (typeof localStorage === 'undefined') return null;
    const session = safeParse(localStorage.getItem(KEY_SESSION), null);
    if (!session || !session.email) return null;
    const profile = readProfiles()[session.email];
    return profile || null;
  }

  function isSignedIn() {
    return currentUser() !== null;
  }

  function signOut() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY_SESSION);
  }

  /** First name only, for greetings. */
  function firstName() {
    const user = currentUser();
    if (!user) return null;
    return String(user.name).trim().split(/\s+/)[0] || null;
  }

  return {
    signIn,
    signOut,
    currentUser,
    isSignedIn,
    firstName,
    initials,
    KEY_PROFILES,
    KEY_SESSION
  };
});
