/* ==========================================================================
   SpendWise — auth-pages.js
   Behaviour for login.html and signup.html.

   Validation happens here; nothing is transmitted anywhere. Passwords are
   checked for shape and then discarded — see js/auth.js for why.
   ========================================================================== */
(function () {
  'use strict';

  const Auth = window.SpendWiseAuth;
  if (!Auth) return;

  const $ = (id) => document.getElementById(id);

  function showError(fieldId, message) {
    const input = $(fieldId);
    const err = $(`err-${fieldId}`);
    if (input) input.classList.add('invalid');
    if (err) {
      err.textContent = message;
      err.classList.add('visible');
    }
  }

  function clearErrors(form) {
    form.querySelectorAll('.field-error').forEach((e) => { e.classList.remove('visible'); e.textContent = ''; });
    form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
  }

  const isValidEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());

  function redirect() {
    window.location.href = 'app.html';
  }

  function wire(formId, handler) {
    const form = $(formId);
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearErrors(form);
      handler();
    });
  }

  /* ------------------------------- Sign in ------------------------------ */

  wire('loginForm', () => {
    const email = $('email').value.trim();
    const password = $('password').value;

    let bad = false;
    if (!isValidEmail(email)) { showError('email', 'Enter a valid email address.'); bad = true; }
    if (!password) { showError('password', 'Enter your password.'); bad = true; }
    if (bad) return;

    // The password is never stored or sent — see js/auth.js.
    const result = Auth.signIn({ email });
    if (!result.ok) { showError('email', result.error); return; }
    redirect();
  });

  /* ------------------------------- Sign up ------------------------------ */

  wire('signupForm', () => {
    const name = $('fullname').value.trim();
    const email = $('email').value.trim();
    const password = $('password').value;
    const confirmEl = $('confirmPassword');
    const confirm = confirmEl ? confirmEl.value : password;

    let bad = false;
    if (name.length < 2) { showError('fullname', 'Tell us what to call you.'); bad = true; }
    if (!isValidEmail(email)) { showError('email', 'Enter a valid email address.'); bad = true; }
    if (password.length < 8) { showError('password', 'Use at least 8 characters.'); bad = true; }
    if (confirmEl && confirm !== password) { showError('confirmPassword', 'Passwords do not match.'); bad = true; }
    if (bad) return;

    const result = Auth.signIn({ name, email });
    if (!result.ok) { showError('email', result.error); return; }
    redirect();
  });

  /* --------------------- "Continue as" shortcut ------------------------- */

  const user = Auth.currentUser();
  if (!user) return;

  const slot = $('existingUser');
  if (slot) {
    slot.hidden = false;
    const btn = $('continueAsBtn');
    if (btn) {
      btn.textContent = `Continue as ${user.name}`;
      btn.addEventListener('click', redirect);
    }
    const who = $('existingUserWho');
    if (who) who.textContent = user.email;
  }

  // On the sign-up page, pre-fill what we already know.
  const emailField = $('email');
  if (emailField && !emailField.value) emailField.value = user.email;
})();
