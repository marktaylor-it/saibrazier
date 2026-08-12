/* Theme toggle — cycles Auto -> Light -> Dark -> Auto.
 *
 * "Auto" means no data-theme attribute at all, so the CSS media query decides.
 * A stored choice is written to localStorage and re-applied by the small inline
 * snippet in each page's <head>; that snippet has to stay inline and synchronous
 * or the page paints in the wrong theme for a frame before correcting itself.
 *
 * Everything is wrapped in try/catch because localStorage throws outright in
 * Safari private browsing rather than failing quietly. */
(function () {
  var root = document.documentElement;
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  var ORDER = ['auto', 'light', 'dark'];
  var LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };

  function current() {
    var t = root.getAttribute('data-theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  }

  function render() {
    var state = current();
    btn.setAttribute('data-state', state);
    btn.querySelector('.theme-name').textContent = LABEL[state];
    btn.setAttribute(
      'aria-label',
      'Colour theme: ' + LABEL[state] + '. Activate to change.'
    );
  }

  btn.addEventListener('click', function () {
    var next = ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length];
    try {
      if (next === 'auto') {
        root.removeAttribute('data-theme');
        localStorage.removeItem('theme');
      } else {
        root.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
      }
    } catch (e) {
      /* storage unavailable — the choice still applies for this page view */
      if (next === 'auto') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', next);
    }
    render();
  });

  btn.hidden = false;
  render();
})();
