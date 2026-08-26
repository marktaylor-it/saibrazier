/* nav.js — submenu disclosure.
 *
 * The markup already works without this file: below 700px the submenus render
 * inline and are always visible, and on pointer devices CSS opens them on hover
 * and on :focus-within. This adds explicit click/Escape control for everyone
 * else, and keeps aria-expanded honest.
 */
(function () {
  'use strict';
  var btns = document.querySelectorAll('.nav-links .navbtn');
  if (!btns.length) return;

  function closeAll(except) {
    btns.forEach(function (b) {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false');
      var m = document.getElementById(b.getAttribute('aria-controls'));
      if (m) m.removeAttribute('data-open');
    });
  }

  btns.forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault();
      var menu = document.getElementById(b.getAttribute('aria-controls'));
      var open = b.getAttribute('aria-expanded') === 'true';
      closeAll(b);
      b.setAttribute('aria-expanded', String(!open));
      if (menu) { if (open) menu.removeAttribute('data-open'); else menu.setAttribute('data-open', 'true'); }
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll(null);
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-links')) closeAll(null);
  });
})();
