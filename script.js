/* ==========================================================================
   SpendWise — script.js
   Landing page interactions only. The app logic lives in dashboard.js.
   ========================================================================== */
(function () {
  'use strict';

  const menuToggle = document.querySelector('.mobile-menu-toggle');
  const navMenu = document.querySelector('.nav-menu');

  if (menuToggle && navMenu) {
    menuToggle.addEventListener('click', () => {
      const open = navMenu.classList.toggle('active');
      menuToggle.setAttribute('aria-expanded', String(open));
    });

    // Close the drawer once a link is chosen.
    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Reveal sections as they scroll into view; skipped entirely for users who
  // prefer reduced motion or on browsers without IntersectionObserver.
  const revealTargets = document.querySelectorAll(
    '.feature-card, .step-card, .privacy-chip, .demo-frame-wrapper'
  );
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (revealTargets.length && !reduceMotion && 'IntersectionObserver' in window) {
    revealTargets.forEach((el) => el.classList.add('reveal'));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    revealTargets.forEach((el) => observer.observe(el));
  }
})();
