/* cms.js — applies Sai's saved content and colours to the public site.
 *
 * DESIGN RULES, in order of importance:
 *
 * 1. PROGRESSIVE ENHANCEMENT. Every word on this site is baked into the HTML.
 *    This file only *overrides* it. If Firebase is blocked, offline, rate
 *    limited, or the free-tier read quota is exhausted, the six core pages
 *    render exactly as they do today. Nothing here is load-bearing.
 *
 * 2. NEVER innerHTML. Stored content is attacker-reachable in the threat model
 *    (a stolen admin session), and this script runs on a page that can hold the
 *    owner's own session. Everything goes in via textContent, which makes
 *    stored XSS structurally impossible rather than merely unlikely.
 *
 * 3. NO SDK. The public site talks to the Firestore REST endpoint with plain
 *    fetch, so there is no CDN dependency and no ~100 KB bundle. One document
 *    read per page view.
 *
 * 4. CACHE FIRST. A repeat visitor gets the last known content applied
 *    synchronously from localStorage before paint (see the inline <head>
 *    snippet), so edits do not cause a visible flash on subsequent loads.
 */
(function () {
  'use strict';

  var PROJECT = 'saibrazier';
  var API_KEY = 'AIzaSyBkOn06OcIbVZEYDUO9HccghFBLb9FKIp0'; // public identifier, not a secret
  var BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT +
             '/databases/(default)/documents';
  var CACHE_KEY = 'cms:content';
  var MIME_OK = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 }; // never svg

  /* ---- Firestore REST value decoding ---------------------------------- */

  function decodeValue(v) {
    if (v === null || v === undefined) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('mapValue' in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
    if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(decodeValue);
    return null;
  }

  function decodeFields(fields) {
    var out = {};
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) {
      out[k] = decodeValue(fields[k]);
    }
    return out;
  }

  function getDoc(path) {
    return fetch(BASE + '/' + path + '?key=' + API_KEY, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.fields ? decodeFields(d.fields) : null; })
      .catch(function () { return null; });   // offline / blocked / quota — stay silent
  }

  /* ---- applying content ------------------------------------------------ */

  function pageSlug() {
    var explicit = document.body.getAttribute('data-page');
    if (explicit) return explicit;
    var f = location.pathname.split('/').pop() || 'index.html';
    return f.replace(/\.html$/, '') || 'index';
  }

  // Text only. See design rule 2.
  // Targets come from the shared selector map, so the markup needs no
  // data- attributes and the admin edits exactly the same set of fields.
  function applyBlocks(blocks, slug) {
    if (!blocks) return;
    var spec = (window.CMS_MAP || {})[slug];
    if (spec) {
      spec.fields.forEach(function (f) {
        var val = blocks[f.key];
        if (typeof val !== 'string' || !val.length) return;
        var el = document.querySelector(f.sel);
        if (el) el.textContent = val;
      });
    }
    // Explicit data-cms attributes still win, for anything the map cannot reach.
    var nodes = document.querySelectorAll('[data-cms]');
    for (var i = 0; i < nodes.length; i++) {
      var v = blocks[nodes[i].getAttribute('data-cms')];
      if (typeof v === 'string' && v.length) nodes[i].textContent = v;
    }
  }

  // Colour overrides are injected as a <style> holding only custom properties,
  // duplicated across the same three blocks the stylesheet uses, because there
  // is no build step to keep light/dark in sync.
  function themeCss(t) {
    if (!t) return '';
    var s = '';
    function esc(h) { return /^#[0-9A-Fa-f]{6}$/.test(h || '') ? h : null; }
    var aL = esc(t.accentLight), aD = esc(t.accentDark);
    var eof = esc(t.eof), bel = esc(t.belingo), r2l = esc(t.r2l);

    if (aL) s += ':root{--venture:' + aL + ';--venture-fill:' + aL + ';--venture-2:' + aL + '}';
    if (eof) s += '.v-eof{--venture-fill:' + eof + '}.sw-eof{background:' + eof + '}';
    if (bel) s += '.v-belingo{--venture-fill:' + bel + '}.sw-belingo{background:' + bel + '}';
    if (r2l) s += '.v-r2l{--venture-fill:' + r2l + '}.sw-r2l{background:' + r2l + '}';
    if (eof && bel && r2l) {
      s += 'body.v-home .site-header::before{background:linear-gradient(90deg,' +
           eof + ' 0 33.333%,' + bel + ' 33.333% 66.666%,' + r2l + ' 66.666% 100%)}';
    }
    if (aD) {
      s += '@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--venture:' + aD + '}}' +
           ':root[data-theme="dark"]{--venture:' + aD + '}';
    }
    return s;
  }

  function applyTheme(t) {
    var css = themeCss(t);
    if (!css) return;
    var el = document.getElementById('cms-theme');
    if (!el) {
      el = document.createElement('style');
      el.id = 'cms-theme';
      document.head.appendChild(el);
    }
    el.textContent = css;
    // Cached as a ready-made string so the inline <head> snippet can re-apply it
    // synchronously on the next visit without recomputing anything.
    try { localStorage.setItem('cms:themecss', css); } catch (e) {}
  }

  // Adds Sai's own pages to the menu. It deliberately does NOT rebuild the nav:
  // the six-item structure with its three submenus is hand-authored in the HTML,
  // and regenerating it from stored data would flatten the dropdowns away the
  // first time anything was published. Stored data can only ever ADD a link.
  function applyNav(nav) {
    if (!nav || !nav.length) return;
    var ul = document.querySelector('.nav-links');
    if (!ul) return;
    var qp = new URLSearchParams(location.search).get('p');

    for (var i = 0; i < nav.length; i++) {
      var item = nav[i];
      if (!item || typeof item.label !== 'string' || typeof item.href !== 'string') continue;
      // Custom pages only. Anything else is ignored outright.
      if (!/^page\.html\?p=[a-z0-9-]{1,40}$/.test(item.href)) continue;
      if (ul.querySelector('a[href="' + item.href + '"]')) continue;

      var li = document.createElement('li');
      var a = document.createElement('a');
      a.setAttribute('href', item.href);
      a.textContent = item.label;
      if (qp && item.href === 'page.html?p=' + qp) a.setAttribute('aria-current', 'page');
      li.appendChild(a);
      ul.appendChild(li);
    }
  }


  // Only these URL shapes are ever written to an href. Stored content is
  // attacker-reachable in the threat model, and an unvalidated href is a
  // javascript: injection straight into a page that may hold an admin session.
  function safeHref(h) {
    if (typeof h !== 'string') return null;
    h = h.trim();
    if (/^https?:\/\//i.test(h)) return h;
    if (/^mailto:[^\s<>"']+$/i.test(h)) return h;
    if (/^[A-Za-z0-9._~-]+\.html(\?p=[a-z0-9-]{1,40})?(#[A-Za-z0-9_-]+)?$/.test(h)) return h;
    if (/^#[A-Za-z0-9_-]+$/.test(h)) return h;
    return null;                       // blocks javascript:, data:, vbscript:
  }

  function applyLinks(links) {
    if (!links) return;
    Object.keys(links).forEach(function (key) {
      var el = document.querySelector('[data-cms-link="' + key.replace(/"/g, '') + '"]');
      if (!el) return;
      var v = links[key] || {};
      if (typeof v.text === 'string' && v.text.trim()) el.textContent = v.text;
      var href = safeHref(v.href);
      if (href) el.setAttribute('href', href);
    });
  }

  function applyMeta(meta) {
    if (!meta) return;
    if (typeof meta.title === 'string' && meta.title.trim()) {
      document.title = meta.title.slice(0, 200);
    }
    if (typeof meta.description === 'string' && meta.description.trim()) {
      var m = document.querySelector('meta[name="description"]');
      if (!m) { m = document.createElement('meta'); m.setAttribute('name','description'); document.head.appendChild(m); }
      m.setAttribute('content', meta.description.slice(0, 400));
    }
  }

  function applyImages(images, slug) {
    if (!images) return;
    var spec = (window.CMS_MAP || {})[slug];
    var bySlot = {};
    if (spec) spec.images.forEach(function (im) { bySlot[im.slot] = im.sel; });

    Object.keys(images).forEach(function (slot) {
      var id = images[slot];
      var sel = bySlot[slot] || '[data-cms-img="' + slot + '"]';
      var target = document.querySelector(sel);
      if (!target || typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) return;
      getDoc('media/' + id).then(function (m) {
        if (!m || !MIME_OK[m.mime] || typeof m.b64 !== 'string') return;
        target.removeAttribute('srcset');
        target.setAttribute('src', 'data:' + m.mime + ';base64,' + m.b64);
        if (typeof m.alt === 'string' && m.alt) target.setAttribute('alt', m.alt);
      });
    });
  }

  // Answers to the open questions. A filled-in answer replaces the dashed
  // placeholder chip and drops the .todo styling, so it reads as ordinary copy.
  function applyTodos(content, slug) {
    var store = (((content.pages || {}).__todos) || {}).blocks;
    if (!store || !window.CMS_TODOS) return;
    window.CMS_TODOS.forEach(function (t) {
      if (t.page !== slug || !t.sel) return;
      var val = store[t.key];
      if (typeof val !== 'string' || !val.trim()) return;
      var el = document.querySelector(t.sel);
      if (!el) return;
      el.textContent = val.trim();
      el.classList.remove('todo');
    });
  }

  function apply(content) {
    if (!content) return;
    try {
      applyTheme(content.theme);
      applyNav(content.nav);
      var slug = pageSlug();
      var page = (content.pages || {})[slug];
      if (page) {
        applyBlocks(page.blocks, slug);
        applyLinks(page.links);
        applyMeta(page.meta);
        applyImages(page.images, slug);
      }
      applyTodos(content, slug);
    } catch (e) { /* never let a bad document break the baked-in page */ }
  }

  // Expose for page.html, which renders entirely from the document.
  window.__cms = { getDoc: getDoc, apply: apply, cacheKey: CACHE_KEY };

  /* ---- run -------------------------------------------------------------- */

  getDoc('public/content').then(function (content) {
    if (!content) return;
    apply(content);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(content)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('cms:loaded', { detail: content }));
  });
})();
