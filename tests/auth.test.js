/* ==========================================================================
   SpendWise — auth tests
   Covers js/auth.js (pure) and the revived login.html / signup.html pages,
   which shipped fully commented out and therefore rendered blank.
   ========================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const AUTH = read('js/auth.js');
const AUTH_PAGES = read('js/auth-pages.js');

/* ------------------------------------------------------------------ *
 * js/auth.js — pure module
 * ------------------------------------------------------------------ */

function authModule() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    runScripts: 'dangerously'
  });
  dom.window.eval(AUTH);
  return { Auth: dom.window.SpendWiseAuth, storage: dom.window.localStorage };
}

test('auth.js exposes its API on the window', () => {
  const { Auth } = authModule();
  assert.ok(Auth);
  ['signIn', 'signOut', 'currentUser', 'isSignedIn', 'firstName', 'initials'].forEach((fn) => {
    assert.equal(typeof Auth[fn], 'function', `${fn} missing`);
  });
});

test('signIn rejects a malformed email', () => {
  const { Auth } = authModule();
  ['nope', 'no@pe', '@example.com', 'a@b', ''].forEach((bad) => {
    assert.equal(Auth.signIn({ email: bad }).ok, false, `"${bad}" should be rejected`);
  });
});

test('signIn creates a profile, normalises the email and derives initials', () => {
  const { Auth, storage } = authModule();
  const result = Auth.signIn({ name: 'Ada Lovelace', email: '  Ada@Example.COM ' });

  assert.equal(result.ok, true);
  assert.equal(result.profile.name, 'Ada Lovelace');
  assert.equal(result.profile.email, 'ada@example.com');
  assert.equal(result.profile.initials, 'AL');
  assert.ok(storage.getItem('spendwise_profiles').includes('ada@example.com'));
});

test('initials handles single names, empty strings and long names', () => {
  const { Auth } = authModule();
  assert.equal(Auth.initials('Ada Lovelace'), 'AL');
  assert.equal(Auth.initials('ada'), 'AD');
  assert.equal(Auth.initials(''), '?');
  assert.equal(Auth.initials('Grace Brewster Murray Hopper'), 'GH');
});

test('a password is never persisted anywhere', () => {
  const { Auth, storage } = authModule();
  Auth.signIn({ name: 'Ada', email: 'ada@example.com' });
  const dump = JSON.stringify(Object.keys(storage).map((k) => [k, storage.getItem(k)]));
  assert.ok(!/password/i.test(dump), 'the word "password" appeared in stored data');
});

test('currentUser returns the profile and signOut clears the session', () => {
  const { Auth } = authModule();
  Auth.signIn({ name: 'Ada Lovelace', email: 'ada@example.com' });

  assert.equal(Auth.isSignedIn(), true);
  assert.equal(Auth.currentUser().name, 'Ada Lovelace');
  assert.equal(Auth.firstName(), 'Ada');

  Auth.signOut();
  assert.equal(Auth.isSignedIn(), false);
  assert.equal(Auth.currentUser(), null);
  assert.equal(Auth.firstName(), null);
});

test('signing in again reuses the stored profile', () => {
  const { Auth } = authModule();
  Auth.signIn({ name: 'Ada Lovelace', email: 'ada@example.com' });
  Auth.signOut();
  Auth.signIn({ email: 'ADA@example.com' });
  assert.equal(Auth.currentUser().name, 'Ada Lovelace');
});

test('a nameless sign-in falls back to the email local part', () => {
  const { Auth } = authModule();
  Auth.signIn({ email: 'grace@example.com' });
  assert.equal(Auth.currentUser().name, 'grace');
});

/* ------------------------------------------------------------------ *
 * login.html / signup.html — the pages themselves
 * ------------------------------------------------------------------ */

function bootPage(file, { signedInAs } = {}) {
  const errors = [];
  // jsdom neither performs nor lets you stub navigation, so the redirect is
  // observed as an attempted-navigation error rather than a location change.
  const nav = { attempted: false };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    if (/Not implemented: navigation/.test(e.message)) { nav.attempted = true; return; }
    errors.push(e.message);
  });
  virtualConsole.on('error', () => {});
  virtualConsole.on('warn', () => {});

  const dom = new JSDOM(read(file), {
    url: `http://localhost/${file}`,
    runScripts: 'dangerously',
    virtualConsole
  });

  const { window } = dom;
  const document = window.document;

  if (signedInAs) {
    window.localStorage.setItem('spendwise_profiles', JSON.stringify({
      [signedInAs.email]: { name: signedInAs.name, email: signedInAs.email, initials: 'AL', createdAt: new Date().toISOString() }
    }));
    window.localStorage.setItem('spendwise_session', JSON.stringify({ email: signedInAs.email }));
  }

  window.eval(AUTH);
  window.eval(AUTH_PAGES);

  const $ = (id) => document.getElementById(id);
  return { window, document, errors, nav, $ };
}

test('login.html is real markup, not a commented-out blank page', () => {
  const { document, $ } = bootPage('login.html');
  assert.ok(document.querySelector('#loginForm'), 'login form missing');
  assert.equal($('email').tagName, 'INPUT');
  // The previous revision had the whole document inside an HTML comment.
  assert.ok(document.body.textContent.includes('Welcome back'));
  assert.ok(!document.body.innerHTML.trim().startsWith('<!--'));
});

test('signup.html is real markup with every field the script expects', () => {
  const { document, $ } = bootPage('signup.html');
  assert.ok(document.querySelector('#signupForm'), 'signup form missing');
  ['fullname', 'email', 'password', 'confirmPassword'].forEach((id) => {
    assert.ok($(id), `#${id} missing`);
  });
});

test('login.html validates the email before creating a session', () => {
  const { window, $ } = bootPage('login.html');
  $('email').value = 'not-an-email';
  $('password').value = 'anything';
  $('loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.match($('err-email').textContent, /valid email/i);
  assert.equal($('err-email').classList.contains('visible'), true);
  assert.equal($('email').classList.contains('invalid'), true);
  assert.equal(window.localStorage.getItem('spendwise_session'), null);
});

test('login.html requires a password', () => {
  const { window, $ } = bootPage('login.html');
  $('email').value = 'ada@example.com';
  $('password').value = '';
  $('loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match($('err-password').textContent, /password/i);
});

test('a valid login creates a session and navigates to the app', () => {
  const { window, $, errors, nav } = bootPage('login.html');
  $('email').value = 'ada@example.com';
  $('password').value = 'supersecret';
  $('loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.deepEqual(errors, [], errors.join(' | '));
  const session = JSON.parse(window.localStorage.getItem('spendwise_session'));
  assert.equal(session.email, 'ada@example.com');
  assert.equal(nav.attempted, true, 'a successful login should navigate');
  assert.match(AUTH_PAGES, /window\.location\.href = 'app\.html'/, 'should navigate to the app');
});

test('signup.html enforces name, email, password length and confirmation', () => {
  const { window, $ } = bootPage('signup.html');
  $('fullname').value = 'A';
  $('email').value = 'bad';
  $('password').value = 'short';
  $('confirmPassword').value = 'different';
  $('signupForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.match($('err-fullname').textContent, /call you/i);
  assert.match($('err-email').textContent, /valid email/i);
  assert.match($('err-password').textContent, /8 characters/i);
  assert.match($('err-confirmPassword').textContent, /do not match/i);
  assert.equal(window.localStorage.getItem('spendwise_session'), null);
});

test('a valid signup creates the profile and navigates to the app', () => {
  const { window, $, errors, nav } = bootPage('signup.html');
  $('fullname').value = 'Ada Lovelace';
  $('email').value = 'ada@example.com';
  $('password').value = 'supersecret';
  $('confirmPassword').value = 'supersecret';
  $('signupForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.deepEqual(errors, [], errors.join(' | '));
  const profiles = JSON.parse(window.localStorage.getItem('spendwise_profiles'));
  assert.equal(profiles['ada@example.com'].name, 'Ada Lovelace');
  assert.equal(nav.attempted, true, 'a successful signup should navigate');
});

test('a returning user sees the "continue as" shortcut with their email', () => {
  const { $ } = bootPage('login.html', { signedInAs: { name: 'Ada Lovelace', email: 'ada@example.com' } });
  assert.equal($('existingUser').hidden, false);
  assert.equal($('continueAsBtn').textContent, 'Continue as Ada Lovelace');
  assert.equal($('existingUserWho').textContent, 'ada@example.com');
  assert.equal($('email').value, 'ada@example.com', 'email should be pre-filled');
});

test('the auth pages disclose that no password is stored', () => {
  ['login.html', 'signup.html'].forEach((file) => {
    const { document } = bootPage(file);
    assert.match(document.body.textContent, /Demo sign/i, `${file} should be honest about demo auth`);
    assert.match(document.body.textContent, /never stored|discarded/i, `${file} should say passwords are not kept`);
  });
});
