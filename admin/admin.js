/* admin.js — the editor Sai actually uses.
 *
 * SECURITY NOTES THAT MUST SURVIVE FUTURE EDITS
 *  - The Firebase config below is PUBLIC by design. It identifies the project;
 *    it does not authorise anything. All authority comes from firestore.rules.
 *  - Content is written and previewed with textContent only. NEVER innerHTML.
 *    el() below refuses an `html` property for exactly this reason: stored
 *    content is attacker-reachable in the threat model (a stolen editor
 *    session) and this page holds the owner's own session.
 *  - Every href written anywhere is validated against safeHref().
 *  - Images are resized in the browser and stored as base64 inside Firestore,
 *    because Cloud Storage requires the paid Blaze plan on this project.
 *
 * SHAPE OF THE FILE
 *    helpers -> toast/modal -> state -> preview -> content -> design ->
 *    to-dos -> extra pages -> people -> publish -> wiring
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, setPersistence, browserLocalPersistence,
  sendEmailVerification, createUserWithEmailAndPassword,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBkOn06OcIbVZEYDUO9HccghFBLb9FKIp0',
  authDomain: 'saibrazier.firebaseapp.com',
  projectId: 'saibrazier',
  appId: '1:990148417733:web:a008cb69b0d648d6d9b8ac',
  messagingSenderId: '990148417733'
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const DEFAULT_THEME = {
  accentLight: '#6E2C3A', accentDark: '#D4949B',
  eof: '#56708A', belingo: '#6ACAE0', r2l: '#F89850'
};
/* The site's hand-authored nav lives in the HTML and is never published. This
   list carries ONLY the pages Sai creates, which cms.js appends to the menu. */
const BASE_NAV = [];
const DRAFT_KEY = 'admin:draft';
const SVGNS = 'http://www.w3.org/2000/svg';

let state = null;        // the working copy
let published = null;    // what the site is serving right now
let dirty = false;
let baked = {};          // text baked into the live HTML, per page
let bakedIndex = {};     // slug -> { 'text:key': value, 'link:key': {text,href} }
let bakedImg = {};       // slug -> { slot: src } — the picture currently shipping
let pendingMedia = {};   // slot -> {mime,b64,alt,w,h}
let fieldIndex = {};     // 'text:key' -> input element, for click-to-edit
let loadWarning = null;
let draftTimer = null;

/* ---------- tiny DOM layer -------------------------------------------- */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* el('div', {class:'x', onclick:fn}, 'text', childNode)
   There is deliberately no `html` property. See the security note above. */
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'html') throw new Error('el(): innerHTML is not permitted');
    else if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'value') n.value = v;
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  kids.flat().forEach(c => {
    if (c === null || c === undefined || c === false) return;
    n.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(String(c)) : c);
  });
  return n;
}

/* References a <symbol> from the sprite at the top of index.html. */
function icon(name) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', '#i-' + name);
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

function clone(o) {
  try { return structuredClone(o); } catch (e) { return JSON.parse(JSON.stringify(o)); }
}
function same(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }

/* Nothing below may blank the editor. Each section renders independently and a
   failure is reported in place, because a silent empty panel is impossible to
   tell apart from a feature that does not exist. */
function guard(name, fn, targetSel) {
  try { fn(); }
  catch (e) {
    console.error('[admin] ' + name + ' failed:', e);
    const t = targetSel && document.querySelector(targetSel);
    if (t) t.appendChild(el('p', { class: 'err' },
      name + ' could not load: ' + (e && e.message ? e.message : 'unknown error')));
  }
}
async function guardAsync(name, fn, targetSel) {
  try { await fn(); }
  catch (e) {
    console.error('[admin] ' + name + ' failed:', e);
    const t = targetSel && document.querySelector(targetSel);
    if (t) t.appendChild(el('p', { class: 'err' },
      name + ' could not load: ' + (e && e.message ? e.message : 'unknown error')));
  }
}

/* ---------- toasts and modals ----------------------------------------- */

/* alert() and confirm() block the whole tab, cannot be styled, and on a page
   that owns an iframe they freeze the preview too. Everything user-facing
   goes through these two instead. */
function toast(message, kind) {
  const box = $('#toasts');
  if (!box) return;
  const t = el('div', { class: 'toast ' + (kind || ''), role: 'status' },
    icon(kind === 'bad' ? 'alert' : kind === 'warn' ? 'alert' : 'check-circle'),
    el('span', { class: 'grow', text: message }),
    el('button', { class: 'x', type: 'button', 'aria-label': 'Dismiss',
      onclick: () => t.remove() }, icon('x'))
  );
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 9000 : 4500);
  return t;
}

/* Returns a promise resolving true/false. Focus is trapped inside the dialog
   and returned to whatever opened it. */
function confirmDialog(title, body, confirmLabel, danger) {
  return new Promise(resolve => {
    const back = $('#modal');
    const opener = document.activeElement;
    let done = false;

    function close(v) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      back.textContent = '';
      back.hidden = true;
      if (opener && opener.focus) opener.focus();
      resolve(v);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      if (e.key !== 'Tab') return;
      const f = $$('button, [href], input, select, textarea', back);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    const ok = el('button', {
      class: 'btn ' + (danger ? 'btn-destructive' : 'btn-primary'),
      type: 'button', onclick: () => close(true), text: confirmLabel || 'Confirm'
    });

    back.textContent = '';
    back.appendChild(el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('h2', { text: title }),
      body ? el('p', { text: body }) : null,
      el('div', { class: 'row' },
        el('button', { class: 'btn', type: 'button', onclick: () => close(false), text: 'Cancel' }),
        ok)
    ));
    back.hidden = false;
    back.addEventListener('mousedown', e => { if (e.target === back) close(false); }, { once: true });
    document.addEventListener('keydown', onKey, true);
    ok.focus();
  });
}

/* ---------- contrast --------------------------------------------------- */

function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255);
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Only these URL shapes are ever accepted. Mirrors safeHref() in cms.js — if
   one changes the other must change with it, or the editor will happily accept
   a link the public site then silently drops. */
function safeHref(h) {
  if (typeof h !== 'string') return null;
  h = h.trim();
  if (!h) return '';
  if (/^https?:\/\//i.test(h)) return h;
  if (/^mailto:[^\s<>"']+$/i.test(h)) return h;
  if (/^[A-Za-z0-9._~-]+\.html(\?p=[a-z0-9-]{1,40})?(#[A-Za-z0-9_-]+)?$/.test(h)) return h;
  if (/^#[A-Za-z0-9_-]+$/.test(h)) return h;
  return null;
}

/* ---------- state ------------------------------------------------------ */

function markDirty() {
  dirty = true;
  const n = countChanges();
  setStatus('dirty', n === 1 ? '1 change' : n + ' changes');
  $('#savebar').hidden = false;
  $('#save-msg').textContent = '';
  $('#save-msg').appendChild(el('b', { text: n === 1 ? '1 unpublished change' : n + ' unpublished changes' }));
  updateSideDots();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 600);
}

function setStatus(kind, text) {
  const chip = $('#save-status');
  if (!chip) return;
  chip.hidden = !kind;
  if (!kind) return;
  chip.dataset.state = kind;
  chip.textContent = text;
}

/* A browser crash, an accidental tab close, or a phone running out of memory
   should not cost an afternoon of edits. The draft is keyed to the revision it
   was based on, so it is never offered on top of someone else's newer publish.
   Images are excluded — base64 blows past the localStorage quota. */
function saveDraft() {
  if (!state) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      rev: state.rev || 0, at: Date.now(),
      theme: state.theme, pages: state.pages, custom: state.custom, nav: state.nav
    }));
  } catch (e) { /* quota — the draft is a convenience, never load-bearing */ }
}
function dropDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

async function loadState() {
  let snap = null;
  try {
    // getDoc can wait on the network indefinitely rather than reject. Without a
    // ceiling a slow or blocked connection leaves the editor blank and silent.
    snap = await Promise.race([
      getDoc(doc(db, 'public', 'content')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 8s')), 8000))
    ]);
  } catch (e) {
    console.warn('[admin] could not load saved content:', e && e.message);
    loadWarning = 'Could not reach your saved content. Showing what is currently on the site; publishing still works.';
  }
  state = (snap && snap.exists()) ? snap.data() : null;
  if (!state) {
    state = { rev: 0, theme: { ...DEFAULT_THEME }, nav: [...BASE_NAV], pages: {}, custom: {} };
  }
  state.theme = { ...DEFAULT_THEME, ...(state.theme || {}) };
  state.pages = state.pages || {};
  state.custom = state.custom || {};
  state.nav = Array.isArray(state.nav) ? state.nav : [...BASE_NAV];
  published = clone(state);
}

/* ---------- what is live vs what is baked ------------------------------ */

function bakedVal(slug, kind, key) {
  const ix = bakedIndex[slug] || {};
  return ix[kind + ':' + key];
}
/* What a visitor sees right now: the published override if there is one,
   otherwise the text baked into the HTML. */
function liveVal(slug, kind, key) {
  const p = ((published || {}).pages || {})[slug] || {};
  if (kind === 'text') {
    if (p.blocks && p.blocks[key] !== undefined) return p.blocks[key];
    return bakedVal(slug, 'text', key);
  }
  const b = bakedVal(slug, 'link', key) || { text: '', href: '' };
  const cur = (p.links || {})[key];
  return cur ? { text: cur.text, href: cur.href } : { text: b.text, href: b.href };
}
/* What the editor would publish: the working override, else the baked text. */
function workingVal(slug, kind, key) {
  const p = (state.pages || {})[slug] || {};
  if (kind === 'text') {
    if (p.blocks && p.blocks[key] !== undefined) return p.blocks[key];
    return bakedVal(slug, 'text', key);
  }
  const b = bakedVal(slug, 'link', key) || { text: '', href: '' };
  const cur = (p.links || {})[key];
  return cur ? { text: cur.text, href: cur.href } : { text: b.text, href: b.href };
}

/* Writing an override that exactly matches the baked HTML is pointless — it
   grows the document for nothing — so those keys are deleted instead. Anything
   that differs is stored. */
function setBlock(slug, key, value) {
  state.pages[slug] = state.pages[slug] || {};
  state.pages[slug].blocks = state.pages[slug].blocks || {};
  if (value === bakedVal(slug, 'text', key)) delete state.pages[slug].blocks[key];
  else state.pages[slug].blocks[key] = value;
}
function setLink(slug, key, text, href) {
  const b = bakedVal(slug, 'link', key) || { text: '', href: '' };
  state.pages[slug] = state.pages[slug] || {};
  state.pages[slug].links = state.pages[slug].links || {};
  if (text === b.text && href === b.href) delete state.pages[slug].links[key];
  else state.pages[slug].links[key] = { text, href };
}

function countChanges() {
  if (!state || !published) return 0;
  let n = 0;
  Object.keys(state.theme || {}).forEach(k => {
    if (state.theme[k] !== (published.theme || {})[k]) n++;
  });
  const slugs = new Set(Object.keys(state.pages || {}).concat(Object.keys(published.pages || {})));
  slugs.forEach(slug => {
    const a = (state.pages || {})[slug] || {}, b = (published.pages || {})[slug] || {};
    ['blocks', 'meta'].forEach(part => {
      const ks = new Set(Object.keys(a[part] || {}).concat(Object.keys(b[part] || {})));
      ks.forEach(k => { if (!same((a[part] || {})[k], (b[part] || {})[k])) n++; });
    });
    const lk = new Set(Object.keys(a.links || {}).concat(Object.keys(b.links || {})));
    lk.forEach(k => { if (!same((a.links || {})[k], (b.links || {})[k])) n++; });
    const ik = new Set(Object.keys(a.images || {}).concat(Object.keys(b.images || {})));
    ik.forEach(k => { if (!same((a.images || {})[k], (b.images || {})[k])) n++; });
  });
  const ck = new Set(Object.keys(state.custom || {}).concat(Object.keys(published.custom || {})));
  ck.forEach(k => { if (!same((state.custom || {})[k], (published.custom || {})[k])) n++; });
  n += Object.keys(pendingMedia).length;
  return n;
}

function pageHasChanges(slug) {
  const a = (state.pages || {})[slug] || {}, b = (published.pages || {})[slug] || {};
  return !same(a, b) || Object.values(pendingMedia).some(m => m.slug === slug);
}

function updateSideDots() {
  $$('#page-list button').forEach(btn => {
    const dot = $('.edited', btn);
    if (dot) dot.hidden = !pageHasChanges(btn.dataset.slug);
  });
  const todos = (((state.pages || {}).__todos) || {}).blocks || {};
  const left = (window.CMS_TODOS || []).filter(t => !(todos[t.key] || '').trim()).length;
  const badge = $('#todo-badge');
  if (badge) { badge.textContent = String(left); badge.dataset.empty = left === 0 ? 'true' : 'false'; }
}

/* ---------- reading the page ------------------------------------------- */

/* Reads the page's own HTML, not the DOM of the preview iframe: the iframe has
   already had published content applied over it by cms.js, so its text is the
   live value, not the baked default. The distinction is what makes the "revert"
   button and the changed-dots correct. */
async function readPage(slug) {
  if (baked[slug]) return baked[slug];
  const out = [];
  const ix = {};
  try {
    const html = await fetch(`../${slug}.html`, { cache: 'no-store' }).then(r => r.text());
    const dom = new DOMParser().parseFromString(html, 'text/html');
    // One walk, so fields arrive in the order they appear on the page rather
    // than with every link bunched at the bottom.
    dom.querySelectorAll('[data-cms], [data-cms-link]').forEach(node => {
      const linkKey = node.getAttribute('data-cms-link');
      const label = node.getAttribute('data-cms-label') || linkKey || node.getAttribute('data-cms');
      if (linkKey) {
        const rec = {
          kind: 'link', key: linkKey, label,
          text: node.textContent.replace(/\s+/g, ' ').trim(),
          href: node.getAttribute('href') || ''
        };
        out.push(rec);
        ix['link:' + linkKey] = { text: rec.text, href: rec.href };
      } else {
        const key = node.getAttribute('data-cms');
        const text = node.textContent.trim();
        out.push({
          kind: 'text', key, label,
          text: text.replace(/\s+/g, ' '),
          long: text.length > 90 || node.tagName === 'BLOCKQUOTE'
        });
        ix['text:' + key] = text.replace(/\s+/g, ' ');
      }
    });
    // The picture each slot is currently showing, so an untouched slot shows
    // the real photograph rather than an empty grey square.
    const imgs = {};
    ((window.CMS_MAP || {})[slug] || { images: [] }).images.forEach(im => {
      const node = dom.querySelector(im.sel);
      const src = node && node.getAttribute('src');
      if (src && !/^(https?:|data:|\/)/i.test(src)) imgs[im.slot] = '../' + src;
    });
    bakedImg[slug] = imgs;

    out.meta = {
      title: (dom.querySelector('title') || {}).textContent || '',
      description: (dom.querySelector('meta[name="description"]') || { getAttribute: () => '' }).getAttribute('content') || ''
    };
  } catch (e) { /* offline — nothing to edit */ }
  baked[slug] = out;
  bakedIndex[slug] = ix;
  return out;
}

/* ---------- live preview ------------------------------------------------
   The preview is the real page: ../<slug>.html, same origin, loaded with the
   real site.css. Nothing about it is a mock-up, which is the whole point —
   a colour or a sentence can only be judged where it will actually live.
   ---------------------------------------------------------------------- */

let previewSlug = null;

function previewDoc() {
  const f = $('#preview-frame');
  try { return f && f.contentDocument; } catch (e) { return null; }
}

function previewNav(slug) {
  const f = $('#preview-frame');
  if (!f || previewSlug === slug) return;
  previewSlug = slug;
  f.src = '../' + slug + '.html';
  const open = $('#preview-open');
  if (open) open.setAttribute('href', '../' + slug + '.html');
}

/* Styling and behaviour injected into the previewed page. Kept to an outline
   and a cursor: the preview must still look like the site, not like a tool. */
function previewInject() {
  const d = previewDoc();
  if (!d || !d.head) return;
  let s = d.getElementById('__admin-preview');
  if (!s) {
    s = d.createElement('style');
    s.id = '__admin-preview';
    d.head.appendChild(s);
  }
  s.textContent =
    '[data-cms],[data-cms-link]{cursor:pointer}' +
    '[data-cms]:hover,[data-cms-link]:hover{outline:1px dashed rgba(128,128,128,.85);outline-offset:3px}' +
    '.__hot{outline:2px solid #C4708A!important;outline-offset:3px!important}';

  if (d.__adminWired) return;
  d.__adminWired = true;
  // Capture phase, and nothing is allowed to navigate: a click in the preview
  // means "edit this", never "go there". The arrow button opens a real tab.
  d.addEventListener('click', e => {
    const t = e.target && e.target.closest && e.target.closest('[data-cms], [data-cms-link]');
    e.preventDefault();
    e.stopPropagation();
    if (!t) return;
    const lk = t.getAttribute('data-cms-link');
    focusField(lk ? 'link' : 'text', lk || t.getAttribute('data-cms'));
  }, true);
}

function previewHighlight(kind, key) {
  const d = previewDoc();
  if (!d) return;
  $$('.__hot', d).forEach(n => n.classList.remove('__hot'));
  const sel = kind === 'link'
    ? '[data-cms-link="' + CSS.escape(key) + '"]'
    : '[data-cms="' + CSS.escape(key) + '"]';
  const node = d.querySelector(sel);
  if (!node) return;
  node.classList.add('__hot');
  try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { node.scrollIntoView(); }
}

/* Jump from a click in the preview to the field that controls it. */
function focusField(kind, key) {
  const input = fieldIndex[kind + ':' + key];
  if (!input) return;
  showTab('pages');
  if (NARROW.matches && previewWanted) { previewWanted = false; syncPreview(); }
  // A field hidden by an active search cannot be scrolled to, and un-hiding
  // just that one would leave the filter lying about what it is showing.
  if ($('#field-search').value) { $('#field-search').value = ''; filterFields(); }
  const grp = input.closest('details');
  if (grp) grp.open = true;
  const holder = input.closest('.fld') || input;
  // focus() first, then scroll on the next frame: focusing mid-animation
  // cancels a smooth scrollIntoView, which leaves the right field focused
  // somewhere off screen — invisible, and indistinguishable from doing nothing.
  input.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    try { holder.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    catch (e) { holder.scrollIntoView(); }
  });
  previewHighlight(kind, key);
}

/* One element, one value — called on every keystroke, so it must stay O(1). */
function previewSet(kind, key, value) {
  const d = previewDoc();
  if (!d) return;
  if (kind === 'text') {
    const n = d.querySelector('[data-cms="' + CSS.escape(key) + '"]');
    if (n) { n.textContent = value; n.classList.remove('todo'); }
    return;
  }
  const n = d.querySelector('[data-cms-link="' + CSS.escape(key) + '"]');
  if (!n) return;
  if (value.text !== undefined) n.textContent = value.text;
  const h = safeHref(value.href);
  if (h) n.setAttribute('href', h);
}

/* Full re-apply, after the iframe navigates or cms.js finishes its fetch. */
function previewApplyAll() {
  const d = previewDoc();
  if (!d || !state) return;
  const slug = previewSlug;
  const p = (state.pages || {})[slug] || {};
  Object.keys(p.blocks || {}).forEach(k => previewSet('text', k, p.blocks[k]));
  Object.keys(p.links || {}).forEach(k => previewSet('link', k, p.links[k]));

  const todos = ((state.pages || {}).__todos || {}).blocks || {};
  (window.CMS_TODOS || []).forEach(t => {
    if (t.page !== slug || !t.sel) return;
    const v = (todos[t.key] || '').trim();
    if (!v) return;
    const n = d.querySelector(t.sel);
    if (n) { n.textContent = v; n.classList.remove('todo'); }
  });

  Object.keys(pendingMedia).forEach(slot => {
    const m = pendingMedia[slot];
    if (m.slug !== slug) return;
    const spec = (window.CMS_MAP || {})[slug];
    const im = spec && spec.images.find(x => x.slot === slot);
    const n = im && d.querySelector(im.sel);
    if (n) { n.removeAttribute('srcset'); n.setAttribute('src', 'data:' + m.mime + ';base64,' + m.b64); }
  });

  previewTheme();
}

/* Colour overrides, injected into the previewed page. Mirrors themeCss() in
   cms.js so what is previewed is what will be published. */
function previewTheme() {
  const d = previewDoc();
  if (!d || !d.head || !state) return;
  const t = state.theme || {};
  const ok = h => (/^#[0-9A-Fa-f]{6}$/.test(h || '') ? h : null);
  const aL = ok(t.accentLight), aD = ok(t.accentDark);
  const eof = ok(t.eof), bel = ok(t.belingo), r2l = ok(t.r2l);
  let css = '';
  if (aL) css += ':root{--venture:' + aL + ';--venture-fill:' + aL + ';--venture-2:' + aL + '}';
  if (eof) css += '.v-eof{--venture-fill:' + eof + '}.sw-eof{background:' + eof + '}';
  if (bel) css += '.v-belingo{--venture-fill:' + bel + '}.sw-belingo{background:' + bel + '}';
  if (r2l) css += '.v-r2l{--venture-fill:' + r2l + '}.sw-r2l{background:' + r2l + '}';
  if (eof && bel && r2l) {
    css += 'body.v-home .site-header::before{background:linear-gradient(90deg,' +
           eof + ' 0 33.333%,' + bel + ' 33.333% 66.666%,' + r2l + ' 66.666% 100%)}';
  }
  if (aD) {
    css += '@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--venture:' + aD + '}}' +
           ':root[data-theme="dark"]{--venture:' + aD + '}';
  }
  let s = d.getElementById('__admin-theme');
  if (!s) { s = d.createElement('style'); s.id = '__admin-theme'; d.head.appendChild(s); }
  s.textContent = css;
}

/* ---------- content ---------------------------------------------------- */

function currentSlug() {
  return $('#page-select').value || Object.keys(window.CMS_MAP || {})[0];
}

function skeleton(wrap, rows) {
  wrap.textContent = '';
  const card = el('div', { class: 'card' }, el('div', { class: 'card-body' }));
  for (let i = 0; i < (rows || 5); i++) {
    card.firstChild.appendChild(el('div', { class: 'skeleton sk-line', style: 'width:' + (26 + (i % 3) * 12) + '%' }));
    card.firstChild.appendChild(el('div', { class: 'skeleton sk-field' }));
  }
  wrap.appendChild(card);
}

/* Labels are authored as "Group — Field". Everything before the dash groups
   the page into the sections a reader would recognise. */
function groupOf(f) {
  const parts = String(f.label || '').split('—');
  return parts.length > 1 ? parts[0].trim() : 'Page';
}
function labelOf(f) {
  const parts = String(f.label || '').split('—');
  return parts.length > 1 ? parts.slice(1).join('—').trim() : String(f.label || f.key);
}

async function renderFields() {
  const slug = currentSlug();
  const spec = (window.CMS_MAP || {})[slug] || { images: [], title: slug };
  if (!state) state = { rev: 0, theme: { ...DEFAULT_THEME }, nav: [], pages: {}, custom: {} };

  $('#content-title').textContent = spec.title || slug;
  const ctx = $('#topbar-context');
  ctx.textContent = '';
  ctx.appendChild(document.createTextNode('Editing '));
  ctx.appendChild(el('b', { text: spec.title || slug }));
  $$('#page-list button').forEach(b => b.setAttribute('aria-current', b.dataset.slug === slug ? 'true' : 'false'));
  previewNav(slug);

  const wrap = $('#fields');
  skeleton(wrap, 4);
  const fields = await readPage(slug);
  if (currentSlug() !== slug) return;      // the user moved on while we fetched

  wrap.textContent = '';
  fieldIndex = {};

  $('#content-sub').textContent = fields.length
    ? fields.filter(f => f.kind === 'text').length + ' pieces of text and ' +
      fields.filter(f => f.kind === 'link').length + ' links. Click anything in the preview to jump to it.'
    : 'Nothing editable was found on this page.';

  /* --- page details, collapsed: useful, but not what he came for --- */
  const savedMeta = (state.pages[slug] || {}).meta || {};
  const metaBody = el('div', { class: 'group-body' });
  [['title', 'Browser tab title', false], ['description', 'Search description', true]].forEach(([k, lab, long]) => {
    const input = el(long ? 'textarea' : 'input', long ? { rows: 2 } : { type: 'text' });
    input.value = savedMeta[k] !== undefined ? savedMeta[k] : ((fields.meta || {})[k] || '');
    input.addEventListener('input', () => {
      state.pages[slug] = state.pages[slug] || {};
      state.pages[slug].meta = state.pages[slug].meta || {};
      state.pages[slug].meta[k] = input.value;
      markDirty();
    });
    metaBody.appendChild(el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: lab }), input));
  });
  wrap.appendChild(el('div', { class: 'card' },
    el('details', { class: 'group', 'data-meta': '1' },
      el('summary', {}, icon('chevron'), el('span', { text: 'Page details' }),
        el('span', { class: 'count', text: 'title · description' })),
      metaBody)));

  if (!fields.length) {
    wrap.appendChild(el('div', { class: 'card' }, el('div', { class: 'empty' },
      icon('content'),
      el('h3', { text: 'Nothing to edit here' }),
      el('p', { text: 'This page has no editable text marked up yet.' }))));
    renderImages(slug, spec);
    return;
  }

  /* --- the text itself, grouped by section --- */
  const groups = new Map();
  fields.forEach(f => {
    const g = groupOf(f);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  });

  const card = el('div', { class: 'card' }, el('header', {}, el('h2', { text: 'Text on this page' })));
  groups.forEach((list, name) => {
    const body = el('div', { class: 'group-body' });
    const dot = el('span', { class: 'edited', hidden: true });
    const det = el('details', { class: 'group', open: true },
      el('summary', {}, icon('chevron'), el('span', { text: name }), dot,
        el('span', { class: 'count', text: String(list.length) })),
      body);
    list.forEach(f => body.appendChild(buildField(slug, f, det, dot)));
    card.appendChild(det);
  });
  wrap.appendChild(card);

  refreshDots();
  filterFields();
  renderImages(slug, spec);
  updateSideDots();
}

/* One editable field: label, changed-dot, revert, and the control itself. */
function buildField(slug, f, group, groupDot) {
  const dot = el('span', { class: 'dirty-dot', hidden: true });
  const revert = el('button', { class: 'revert', type: 'button', text: 'Revert', hidden: true });
  const label = el('span', { class: 'fld-label' }, el('span', { text: labelOf(f) }), dot, revert);
  const holder = el('label', { class: 'fld' }, label);
  holder.dataset.search = (labelOf(f) + ' ' + (f.text || '')).toLowerCase();
  holder.dataset.key = f.kind + ':' + f.key;

  function mark() {
    const changed = !same(workingVal(slug, f.kind, f.key), liveVal(slug, f.kind, f.key));
    dot.hidden = !changed;
    revert.hidden = !changed;
    if (groupDot) {
      groupDot.hidden = !$$('.dirty-dot', group).some(d => !d.hidden);
    }
  }
  holder.__mark = mark;

  if (f.kind === 'link') {
    const cur = workingVal(slug, 'link', f.key);
    const t = el('input', { type: 'text', placeholder: 'Link text' });
    const u = el('input', { type: 'text', placeholder: 'https://…', class: 'mono', style: 'margin-top:6px' });
    t.value = cur.text || '';
    u.value = cur.href || '';
    const warn = el('span', { class: 'count' });
    function save() {
      setLink(slug, f.key, t.value, u.value);
      const bad = u.value.trim() && safeHref(u.value) === null;
      warn.textContent = bad ? 'That address will be ignored. Use https://…, an email, or a page on this site.' : '';
      warn.classList.toggle('over', !!bad);
      previewSet('link', f.key, { text: t.value, href: u.value });
      mark(); markDirty();
    }
    t.addEventListener('input', save);
    u.addEventListener('input', save);
    [t, u].forEach(x => x.addEventListener('focus', () => previewHighlight('link', f.key)));
    revert.addEventListener('click', e => {
      e.preventDefault();
      const live = liveVal(slug, 'link', f.key);
      t.value = live.text || ''; u.value = live.href || '';
      save();
    });
    holder.appendChild(el('div', { class: 'field-pair' }, t, u));
    holder.appendChild(warn);
    fieldIndex['link:' + f.key] = t;
    mark();
    return holder;
  }

  const input = el(f.long ? 'textarea' : 'input', f.long ? { rows: 3 } : { type: 'text' });
  input.value = workingVal(slug, 'text', f.key) || '';
  input.addEventListener('input', () => {
    setBlock(slug, f.key, input.value);
    previewSet('text', f.key, input.value);
    mark(); markDirty();
  });
  input.addEventListener('focus', () => previewHighlight('text', f.key));
  revert.addEventListener('click', e => {
    e.preventDefault();
    input.value = liveVal(slug, 'text', f.key) || '';
    setBlock(slug, f.key, input.value);
    previewSet('text', f.key, input.value);
    mark(); markDirty();
  });
  holder.appendChild(input);
  fieldIndex['text:' + f.key] = input;
  mark();
  return holder;
}

function refreshDots() {
  $$('#fields .fld').forEach(h => { if (h.__mark) h.__mark(); });
}

/* Search hides fields rather than rebuilding them, so focus and scroll survive
   typing, and a group that has no match collapses out of the way. */
function filterFields() {
  const q = ($('#field-search').value || '').trim().toLowerCase();
  $('#field-search-clear').hidden = !q;
  $$('#fields .fld').forEach(h => {
    h.hidden = !!q && !(h.dataset.search || '').includes(q);
  });
  $$('#fields details.group').forEach(g => {
    const body = $('.group-body', g);
    if (!body) return;
    const flds = $$('.fld', body);
    if (!flds.length) return;
    const shown = flds.filter(h => !h.hidden).length;
    g.hidden = !!q && shown === 0;
    if (q) g.open = true;
    const count = $('.count', g);
    if (count && !g.dataset.meta) count.textContent = q ? shown + ' / ' + flds.length : String(flds.length);
  });
}

/* ---------- pictures ---------------------------------------------------- */

function renderImages(slug, spec) {
  const wrap = $('#images');
  wrap.textContent = '';
  if (!spec.images || !spec.images.length) return;

  const body = el('div', { class: 'card-body' });
  spec.images.forEach(im => {
    const thumb = el('div', { class: 'img-thumb' }, icon('image'));
    const img = el('img', { alt: '' });
    function show(src) { img.src = src; thumb.textContent = ''; thumb.appendChild(img); }
    const savedId = ((state.pages[slug] || {}).images || {})[im.slot];
    const bakedSrc = (bakedImg[slug] || {})[im.slot];
    if (pendingMedia[im.slot]) {
      show('data:' + pendingMedia[im.slot].mime + ';base64,' + pendingMedia[im.slot].b64);
    } else if (savedId) {
      if (bakedSrc) show(bakedSrc);        // something to look at while the doc loads
      getDoc(doc(db, 'media', savedId)).then(s => {
        if (s.exists()) show('data:' + s.data().mime + ';base64,' + s.data().b64);
      }).catch(() => {});
    } else if (bakedSrc) {
      show(bakedSrc);
    }

    const note = el('span', { class: 'count' });
    const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    const drop = el('label', { class: 'drop' },
      icon('upload'), ' ', el('b', { text: 'Choose a picture' }), ' or drop one here', file);

    async function take(f) {
      if (!f) return;
      note.textContent = 'Resizing…';
      note.classList.remove('over');
      try {
        const out = await resizeToBase64(f, im.maxW);
        pendingMedia[im.slot] = { ...out, alt: '', slug, slot: im.slot };
        img.src = 'data:' + out.mime + ';base64,' + out.b64;
        thumb.textContent = ''; thumb.appendChild(img);
        note.textContent = Math.round(out.b64.length * 0.75 / 1024) + ' KB · ' + out.w + '×' + out.h + ' · not published yet';
        const d = previewDoc();
        const n = d && d.querySelector(im.sel);
        if (n) { n.removeAttribute('srcset'); n.setAttribute('src', img.src); }
        markDirty();
      } catch (err) {
        note.textContent = err.message || 'That image could not be read.';
        note.classList.add('over');
      }
    }

    file.addEventListener('change', () => take(file.files && file.files[0]));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      take(f);
    });

    body.appendChild(el('div', { class: 'img-row' }, thumb,
      el('div', {}, el('div', { class: 'img-name', text: im.label }), drop, note)));
  });

  wrap.appendChild(el('div', { class: 'card' },
    el('header', {}, el('h2', { text: 'Pictures' })), body));
}

/* Canvas resize. Keeps documents well inside Firestore's 1 MiB limit and
   enforces the hard caps the two low-resolution logos depend on. */
function resizeToBase64(file, maxW) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, (maxW || 1400) / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = 0.82, dataUrl = '';
      // Step quality down until it fits comfortably inside the rules' cap.
      for (let i = 0; i < 6; i++) {
        dataUrl = c.toDataURL('image/jpeg', q);
        if (dataUrl.length < 660000) break;
        q -= 0.1;
      }
      const b64 = dataUrl.split(',')[1] || '';
      if (b64.length >= 700000) return reject(new Error('Still too large — try a smaller picture.'));
      resolve({ mime: 'image/jpeg', b64, w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image.')); };
    img.src = url;
  });
}

/* ---------- design ------------------------------------------------------ */

const SWATCHES = [
  { key: 'accentLight', name: 'Accent',        sub: 'Links and underlines, light mode' },
  { key: 'accentDark',  name: 'Accent (dark)', sub: 'Links and underlines, dark mode' },
  { key: 'eof',         name: 'Eye of Faith',  sub: 'Stripe and swatch on the podcast page' },
  { key: 'belingo',     name: 'BeLingo',       sub: 'Stripe and swatch on the BeLingo page' },
  { key: 'r2l',         name: 'run2live',      sub: 'Stripe and lane on the run2live page' }
];

function renderColors() {
  const wrap = $('#swatches');
  wrap.textContent = '';
  SWATCHES.forEach(s => {
    const picker = el('input', { type: 'color', 'aria-label': s.name, value: state.theme[s.key] });
    const hex = el('input', { type: 'text', 'aria-label': s.name + ' hex', value: state.theme[s.key] });
    function set(v) {
      if (!/^#[0-9a-f]{6}$/i.test(v)) return;
      state.theme[s.key] = v.toUpperCase();
      picker.value = v; hex.value = v.toUpperCase();
      markDirty(); checkContrast(); previewTheme();
    }
    picker.addEventListener('input', () => set(picker.value));
    hex.addEventListener('change', () => set(hex.value.trim()));
    wrap.appendChild(el('div', { class: 'swatch-row' }, picker,
      el('div', {}, el('span', { class: 'swatch-name', text: s.name }),
                    el('span', { class: 'swatch-sub', text: s.sub })),
      hex));
  });
  checkContrast(); previewTheme();
}

/* A single bad hex can drop the whole site to unreadable. Publishing is blocked
   while any accent fails AA against its own background. */
function checkContrast() {
  const box = $('#contrast');
  const tests = [
    { label: 'Accent on light paper', fg: state.theme.accentLight, bg: '#F7F5F1' },
    { label: 'Accent on dark ground', fg: state.theme.accentDark,  bg: '#121110' }
  ];
  box.textContent = '';
  let worst = 99;
  tests.forEach(t => {
    const r = ratio(t.fg, t.bg);
    if (r === null) return;
    worst = Math.min(worst, r);
    box.appendChild(el('div', {},
      icon(r >= 4.5 ? 'check-circle' : 'alert'),
      t.label + ': ' + r.toFixed(2) + ':1 ' + (r >= 4.5 ? 'passes' : 'too faint')));
  });
  const bad = worst < 4.5;
  box.classList.toggle('bad', bad);
  box.classList.toggle('good', !bad);
  if (bad) {
    box.appendChild(el('div', { text: 'Pick a deeper colour — text this faint is hard to read, and publishing is blocked until it passes.' }));
  }
  $('#publish').disabled = bad;
  return !bad;
}

/* ---------- to-dos ------------------------------------------------------ */

function renderTodos() {
  const wrap = $('#todos');
  wrap.textContent = '';
  // The published document once contained __todos WITHOUT a blocks map, in
  // which case the old one-liner left `store` undefined and every keystroke
  // threw. Build it defensively in two steps.
  state.pages.__todos = state.pages.__todos || {};
  state.pages.__todos.blocks = state.pages.__todos.blocks || {};
  const store = state.pages.__todos.blocks;

  (window.CMS_TODOS || []).forEach(t => {
    const row = el('div', { class: 'todo-row' + (store[t.key] ? ' done' : '') });
    const tick = el('span', { class: 'tick' }, icon('check'));
    row.appendChild(el('div', { class: 'todo-head' }, tick,
      el('span', { class: 'list-title', text: t.label }),
      el('span', { class: 'pill', text: (window.CMS_MAP[t.page] || {}).title || t.page })));
    if (t.hint) row.appendChild(el('span', { class: 'list-sub', text: t.hint }));

    const input = el('input', { type: 'text', 'aria-label': t.label, value: store[t.key] || '' });
    input.addEventListener('input', () => {
      store[t.key] = input.value;
      row.classList.toggle('done', !!input.value.trim());
      if (t.page === previewSlug && t.sel) {
        const d = previewDoc();
        const n = d && d.querySelector(t.sel);
        if (n && input.value.trim()) { n.textContent = input.value.trim(); n.classList.remove('todo'); }
      }
      markDirty();
    });
    row.appendChild(input);
    wrap.appendChild(row);
  });
  updateSideDots();
}

/* ---------- extra pages ------------------------------------------------- */

const RESERVED = ['index', 'about', 'belingo', 'eye-of-faith', 'run2live', 'contact',
                  'business-ventures', 'publications', 'podcasts', 'page', 'admin', 'assets'];

function renderCustom() {
  const wrap = $('#custom-list');
  wrap.textContent = '';
  const slugs = Object.keys(state.custom);
  if (!slugs.length) {
    wrap.appendChild(el('div', { class: 'empty' }, icon('pages'),
      el('h3', { text: 'No extra pages yet' }),
      el('p', { text: 'Anything you add below joins the menu on every page.' })));
    return;
  }

  slugs.forEach(slug => {
    const pg = state.custom[slug];
    const title = el('div', { class: 'list-title', text: pg.title || slug });
    const form = el('div', { class: 'card-body', hidden: true });

    function field(labelText, value, rows) {
      const control = el(rows ? 'textarea' : 'input', rows ? { rows } : { type: 'text' });
      control.value = value || '';
      form.appendChild(el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: labelText }), control));
      return control;
    }
    const fTitle = field('Title', pg.title);
    const fLede = field('Opening line', pg.lede, 2);
    const fBody = field('Body', (pg.sections && pg.sections[0] ? pg.sections[0].body : ''), 8);

    [fTitle, fLede, fBody].forEach(x => x.addEventListener('input', () => {
      pg.title = fTitle.value.trim();
      pg.lede = fLede.value;
      pg.sections = [{ heading: '', body: fBody.value }];
      title.textContent = pg.title || slug;
      // keep the menu label in step with the title
      const navItem = state.nav.find(n => n.href === 'page.html?p=' + slug);
      if (navItem) navItem.label = pg.title || slug;
      markDirty();
    }));

    const edit = el('button', { class: 'btn btn-sm', type: 'button', text: 'Edit' });
    edit.addEventListener('click', () => {
      form.hidden = !form.hidden;
      edit.textContent = form.hidden ? 'Edit' : 'Done';
    });
    const del = el('button', { class: 'btn btn-sm btn-danger', type: 'button', 'aria-label': 'Delete ' + (pg.title || slug) }, icon('trash'));
    del.addEventListener('click', async () => {
      const yes = await confirmDialog('Delete this page?',
        '“' + (pg.title || slug) + '” will be removed from the site and from the menu when you publish.',
        'Delete', true);
      if (!yes) return;
      delete state.custom[slug];
      state.nav = state.nav.filter(n => n.href !== 'page.html?p=' + slug);
      markDirty(); renderCustom();
    });

    wrap.appendChild(el('div', {},
      el('div', { class: 'list-row' },
        el('div', { class: 'grow' }, title,
          el('span', { class: 'list-sub mono', text: 'saibrazier.com/page.html?p=' + slug })),
        el('div', { class: 'row' }, edit, del)),
      form));
  });
}

function addCustomPage() {
  const title = $('#np-title').value.trim();
  let slug = $('#np-slug').value.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!title) return toast('Give the page a title.', 'bad');
  if (!slug) slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return toast('That web address will not work. Use letters, numbers and hyphens.', 'bad');
  if (RESERVED.includes(slug)) return toast('“' + slug + '” is reserved by an existing page. Pick another address.', 'bad');
  if (state.custom[slug]) return toast('A page with that address already exists.', 'bad');
  if (Object.keys(state.custom).length >= 12) return toast('That is as many extra pages as the menu can hold.', 'bad');

  state.custom[slug] = {
    title,
    lede: $('#np-lede').value.trim(),
    sections: [{ heading: '', body: $('#np-body').value.trim() }]
  };
  if (!state.nav.some(n => n.href === 'page.html?p=' + slug)) {
    state.nav.push({ label: title, href: 'page.html?p=' + slug });
  }
  $('#np-title').value = ''; $('#np-slug').value = '';
  $('#np-lede').value = ''; $('#np-body').value = '';
  markDirty(); renderCustom();
  toast('“' + title + '” added. Publish to put it on the site.', 'ok');
}

/* ---------- who can get in ---------------------------------------------- */

const OWNER_UID = 'tIvm5pmAbWVMQ5UmSDr67Q4zHrg1';   // must match firestore.rules

async function renderAccess() {
  const status = $('#access-status');
  const list = $('#access-list');
  if (!status || !list) return;
  status.textContent = '';
  list.textContent = '';

  const u = auth.currentUser;
  const isOwner = u && u.uid === OWNER_UID;

  const pill = isOwner
    ? el('span', { class: 'pill pill-owner', text: 'Owner' })
    : el('span', { class: 'pill ' + (u && u.emailVerified ? 'pill-ok' : 'pill-warn'),
                   text: u && u.emailVerified ? 'Verified' : 'Not verified' });

  const row = el('div', { class: 'list-row' },
    el('div', { class: 'grow' },
      el('div', { class: 'list-title', text: u ? u.email : '' }),
      el('span', { class: 'list-sub', text: isOwner
        ? 'Full access, permanently. Cannot be removed by anyone.'
        : (u && u.emailVerified ? 'Can edit and publish.' : 'Can look, but cannot publish until the email is verified.') })),
    pill);
  status.appendChild(row);

  if (u && !u.emailVerified) {
    const v = el('button', { class: 'btn btn-sm', type: 'button', text: 'Send me a verification email' });
    v.addEventListener('click', async () => {
      v.disabled = true;
      try { await sendEmailVerification(u); toast('Sent — check your inbox.', 'ok'); v.textContent = 'Sent'; }
      catch (e) { toast('Could not send: ' + (e.code || e.message), 'bad'); v.disabled = false; }
    });
    status.appendChild(el('div', { class: 'card-body' }, v));
  }

  let snaps = [];
  try { snaps = (await getDocs(collection(db, 'admins'))).docs; }
  catch (e) {
    list.appendChild(el('p', { class: 'err', text: 'Could not read the access list: ' + (e.code || e.message) }));
    return;
  }

  if (!snaps.length) {
    list.appendChild(el('div', { class: 'empty' }, icon('people'),
      el('h3', { text: 'Nobody else has access' }),
      el('p', { text: 'Only you can sign in and change this site.' })));
    return;
  }

  snaps.forEach(d => {
    const data = d.data() || {};
    const rm = el('button', { class: 'btn btn-sm btn-danger', type: 'button',
                              'aria-label': 'Remove ' + (data.email || d.id) }, icon('trash'));
    rm.addEventListener('click', async () => {
      const yes = await confirmDialog('Remove access?',
        (data.email || d.id) + ' will no longer be able to change anything on the site.', 'Remove', true);
      if (!yes) return;
      try { await deleteDoc(doc(db, 'admins', d.id)); toast('Access removed.', 'ok'); renderAccess(); }
      catch (e) { toast('Could not remove: ' + (e.code || e.message), 'bad'); }
    });
    list.appendChild(el('div', { class: 'list-row' },
      el('div', { class: 'grow' },
        el('div', { class: 'list-title', text: data.email || d.id }),
        el('span', { class: 'list-sub', text: (data.note ? data.note + ' · ' : '') + 'added by ' + (data.addedBy || 'unknown') })),
      rm));
  });
}

/* Changing a password while signed in. Firebase refuses this if the session is
   more than a few minutes old (auth/requires-recent-login), which is a good
   protection: it means someone who walks up to an unlocked laptop cannot
   silently take the account over. When that happens we ask for the current
   password and reauthenticate rather than dumping the raw error. */
async function changePassword() {
  const msg = $('#pw-msg');
  const next = $('#pw-new').value;
  const btn = $('#pw-save');
  msg.hidden = true;

  if (!next || next.length < 8) {
    msg.textContent = 'Use at least 8 characters.';
    msg.hidden = false;
    return;
  }
  const u = auth.currentUser;
  if (!u) { msg.textContent = 'You are signed out.'; msg.hidden = false; return; }

  btn.disabled = true;
  try {
    await updatePassword(u, next);
    toast('Password changed.', 'ok');
    $('#pw-new').value = '';
    $('#pw-current').value = '';
    $('#pw-current-wrap').hidden = true;
  } catch (ex) {
    if (ex.code === 'auth/requires-recent-login') {
      const cur = $('#pw-current').value;
      if (!cur) {
        $('#pw-current-wrap').hidden = false;
        msg.textContent = 'For safety, confirm your current password and press again.';
        msg.hidden = false;
      } else {
        try {
          await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, cur));
          await updatePassword(u, next);
          toast('Password changed.', 'ok');
          $('#pw-new').value = ''; $('#pw-current').value = '';
          $('#pw-current-wrap').hidden = true;
        } catch (e2) {
          msg.textContent = e2.code === 'auth/invalid-credential' || e2.code === 'auth/wrong-password'
            ? 'That current password is not right.'
            : 'Could not change it: ' + (e2.code || e2.message);
          msg.hidden = false;
        }
      }
    } else {
      msg.textContent = 'Could not change it: ' + (ex.code || ex.message);
      msg.hidden = false;
    }
  } finally {
    btn.disabled = false;
  }
}

async function addAccess() {
  const email = ($('#acc-email').value || '').trim().toLowerCase();
  const note = ($('#acc-note').value || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('That does not look like an email address.', 'bad');
  try {
    await setDoc(doc(db, 'admins', email), {
      email: email, note: note,
      addedBy: auth.currentUser ? auth.currentUser.email : '',
      addedAt: new Date().toISOString()
    });
    $('#acc-email').value = ''; $('#acc-note').value = '';
    toast(email + ' can now create an account and edit the site.', 'ok');
    renderAccess();
  } catch (e) {
    toast('Could not give access: ' + (e.code || e.message), 'bad');
  }
}

/* ---------- publish ----------------------------------------------------- */

async function publish() {
  if (!checkContrast()) { toast('Fix the colour contrast before publishing.', 'bad'); return; }
  const btn = $('#publish');
  btn.disabled = true;
  setStatus('saving', 'Publishing…');
  $('#save-msg').textContent = 'Publishing…';
  try {
    // Images first, so the content document never references a missing doc.
    for (const slot of Object.keys(pendingMedia)) {
      const m = pendingMedia[slot];
      const id = 'm_' + Math.abs(hash(slot + m.b64.slice(0, 64))).toString(36);
      await setDoc(doc(db, 'media', id), {
        mime: m.mime, b64: m.b64, alt: m.alt || '',
        w: m.w, h: m.h, updatedAt: new Date().toISOString()
      });
      state.pages[m.slug] = state.pages[m.slug] || { blocks: {}, images: {} };
      state.pages[m.slug].images = state.pages[m.slug].images || {};
      state.pages[m.slug].images[m.slot] = id;
    }
    pendingMedia = {};

    await setDoc(doc(db, 'public', 'content'), {
      theme: state.theme,
      nav: state.nav,
      pages: state.pages,
      custom: state.custom,
      rev: (state.rev || 0) + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.currentUser ? auth.currentUser.email : ''
    });
    state.rev = (state.rev || 0) + 1;
    published = clone(state);
    dirty = false;
    dropDraft();
    refreshDots();
    updateSideDots();
    setStatus('saved', 'Published');
    $('#save-msg').textContent = '';
    $('#save-msg').appendChild(el('b', { text: 'Published' }));
    toast('Your site is updated.', 'ok');
    setTimeout(() => { if (!dirty) { $('#savebar').hidden = true; setStatus(null); } }, 2500);
  } catch (e) {
    setStatus('error', 'Not published');
    $('#save-msg').textContent = 'Could not publish: ' + (e.code || e.message || 'unknown error');
    toast('Could not publish: ' + (e.code || e.message || 'unknown error'), 'bad');
  } finally {
    btn.disabled = false;
  }
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

/* ---------- navigation -------------------------------------------------- */

function showTab(name) {
  $$('.side-item').forEach(b => b.setAttribute('aria-current', b.dataset.tab === name ? 'true' : 'false'));
  $$('.panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
  closeDrawer();
}

function buildPageList() {
  const ul = $('#page-list');
  ul.textContent = '';
  Object.keys(window.CMS_MAP || {}).forEach(slug => {
    const btn = el('button', { type: 'button', 'data-slug': slug, 'aria-current': 'false' },
      el('span', { text: window.CMS_MAP[slug].title || slug }),
      el('span', { class: 'edited', hidden: true }));
    btn.addEventListener('click', () => {
      $('#page-select').value = slug;
      showTab('pages');
      $('#field-search').value = '';
      renderFields();
    });
    ul.appendChild(el('li', {}, btn));
  });
}

function openDrawer() {
  $('#sidebar').classList.add('open');
  $('#menu-toggle').setAttribute('aria-expanded', 'true');
  if (!$('#scrim')) {
    const s = el('div', { class: 'scrim', id: 'scrim', onclick: closeDrawer });
    document.body.appendChild(s);
  }
}
function closeDrawer() {
  $('#sidebar').classList.remove('open');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
  const s = $('#scrim');
  if (s) s.remove();
}

/* Appearance follows the same three-state rule as the public site — and the
   same localStorage key — so the editor and the site never disagree. */
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  let cur = 'auto';
  try { cur = localStorage.getItem('theme') || 'auto'; } catch (e) {}
  const next = order[(order.indexOf(cur) + 1) % 3];
  try { next === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', next); } catch (e) {}
  paintTheme();
  const d = previewDoc();
  if (d) {
    if (next === 'auto') d.documentElement.removeAttribute('data-theme');
    else d.documentElement.setAttribute('data-theme', next);
  }
}
function paintTheme() {
  let cur = 'auto';
  try { cur = localStorage.getItem('theme') || 'auto'; } catch (e) {}
  if (cur === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', cur);
  const btn = $('#theme-btn');
  if (!btn) return;
  btn.textContent = '';
  btn.appendChild(icon(cur === 'auto' ? 'auto' : cur === 'light' ? 'sun' : 'moon'));
  btn.setAttribute('aria-label', 'Appearance: ' + (cur === 'auto' ? 'follow system' : cur));
}

/* ---------- wiring ------------------------------------------------------ */

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#login-err');
  err.hidden = true;
  $('#login-btn').disabled = true;
  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithEmailAndPassword(auth, $('#email').value.trim(), $('#password').value);
  } catch (ex) {
    const map = {
      'auth/invalid-credential': 'That email and password do not match.',
      'auth/invalid-email': 'That does not look like an email address.',
      'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
      'auth/network-request-failed': 'No connection. Check your internet and try again.',
      'auth/user-disabled': 'That account has been disabled.'
    };
    err.textContent = map[ex.code] || 'Could not sign in. Please try again.';
    err.hidden = false;
  } finally {
    $('#login-btn').disabled = false;
  }
});

$('#reset-btn').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  const err = $('#login-err');
  if (!email) { err.textContent = 'Type your email address first, then press this again.'; err.hidden = false; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    err.textContent = 'Sent. Check your email for a link to set a new password.';
  } catch (ex) {
    const map = {
      'auth/invalid-email': 'That does not look like an email address.',
      'auth/user-not-found': 'No account uses that address. Use Create account.',
      'auth/too-many-requests': 'Too many attempts. Wait a few minutes.',
      'auth/network-request-failed': 'No connection.'
    };
    err.textContent = map[ex.code] || ('Could not send a reset email: ' + (ex.code || ex.message));
  }
  err.hidden = false;
});

/* Account creation is deliberately open here, and that is not a weakening:
   Firebase's signup endpoint is already reachable by anyone holding the public
   apiKey, so hiding this button would be theatre. Authority comes from
   firestore.rules, which requires BOTH an entry in /admins AND a verified email
   address. Someone who creates an account they were not invited to gets an
   account that can change nothing. */
$('#create-btn').addEventListener('click', async () => {
  const err = $('#login-err');
  const email = $('#email').value.trim();
  const pw = $('#password').value;
  err.hidden = true;
  if (!email || pw.length < 8) {
    err.textContent = 'Enter your email and a password of at least 8 characters.';
    err.hidden = false;
    return;
  }
  $('#create-btn').disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await sendEmailVerification(cred.user);
    err.textContent = 'Account created. Check your email and click the verification link, then sign in.';
    err.hidden = false;
  } catch (ex) {
    const map = {
      'auth/email-already-in-use': 'That email already has an account. Use Forgot password.',
      'auth/invalid-email': 'That does not look like an email address.',
      'auth/weak-password': 'Use a longer password.',
      'auth/network-request-failed': 'No connection.'
    };
    err.textContent = map[ex.code] || ('Could not create the account: ' + (ex.code || ex.message));
    err.hidden = false;
  } finally {
    $('#create-btn').disabled = false;
  }
});

$('#signout').addEventListener('click', async () => {
  if (dirty) {
    const yes = await confirmDialog('Sign out with unpublished changes?',
      'Your changes are kept in this browser and offered back next time you sign in.', 'Sign out');
    if (!yes) return;
  }
  signOut(auth);
});

$$('.side-item').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#menu-toggle').addEventListener('click', () => {
  $('#sidebar').classList.contains('open') ? closeDrawer() : openDrawer();
});
$('#theme-btn').addEventListener('click', cycleTheme);

$('#field-search').addEventListener('input', filterFields);
$('#field-search-clear').addEventListener('click', () => {
  $('#field-search').value = '';
  filterFields();
  $('#field-search').focus();
});

$('#page-select').addEventListener('change', renderFields);
$('#np-add').addEventListener('click', addCustomPage);
$('#acc-add').addEventListener('click', addAccess);
$('#pw-save').addEventListener('click', changePassword);
$('#publish').addEventListener('click', publish);

$('#discard').addEventListener('click', async () => {
  const yes = await confirmDialog('Discard every change?',
    'Everything you have changed since the last publish will be thrown away.', 'Discard', true);
  if (!yes) return;
  pendingMedia = {}; baked = {}; bakedIndex = {}; bakedImg = {};
  dropDraft();
  await loadState();
  await renderFields(); renderColors(); renderTodos(); renderCustom();
  dirty = false;
  $('#savebar').hidden = true;
  setStatus(null);
  const f = $('#preview-frame');
  if (f && previewSlug) { f.src = f.src; }
  toast('Changes discarded.', 'ok');
});

$('#reset-colors').addEventListener('click', () => {
  state.theme = { ...DEFAULT_THEME };
  renderColors(); markDirty();
});

/* preview chrome */
$('#preview-frame').addEventListener('load', () => {
  const d = previewDoc();
  if (!d) return;
  fitPreview();
  previewInject();
  previewApplyAll();
  // cms.js applies published content asynchronously; re-apply on top of it.
  d.addEventListener('cms:loaded', () => setTimeout(previewApplyAll, 0));
  setTimeout(previewApplyAll, 400);
});
$('#dev-desktop').addEventListener('click', () => setDevice('desktop'));
$('#dev-phone').addEventListener('click', () => setDevice('phone'));
function setDevice(name) {
  $('#preview-wrap').dataset.device = name;
  $('#dev-desktop').setAttribute('aria-pressed', name === 'desktop' ? 'true' : 'false');
  $('#dev-phone').setAttribute('aria-pressed', name === 'phone' ? 'true' : 'false');
  fitPreview();
}

/* The preview panel is ~500px wide. A page loaded into a 500px iframe renders
   its PHONE layout, so without this the desktop preview would never once show
   what a desktop visitor actually sees. Lay the frame out at a true viewport
   width and scale the whole thing down to fit the panel. */
function fitPreview() {
  const wrap = $('#preview-wrap');
  const f = $('#preview-frame');
  if (!wrap || !f) return;
  const base = wrap.dataset.device === 'phone' ? 390 : 1280;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  const s = Math.min(1, w / base);
  f.style.width = base + 'px';
  f.style.height = Math.round(h / s) + 'px';
  f.style.transform = s === 1 ? 'none' : 'scale(' + s.toFixed(4) + ')';
}
/* Below 1180px the preview stops being a third column and becomes a panel that
   slides over the editor, so it must start closed — otherwise the first thing
   a narrow window shows is a preview covering the fields. `previewWanted` is
   the user's own choice and survives crossing the breakpoint in both
   directions. */
const NARROW = window.matchMedia('(max-width: 1180px)');
let previewWanted = false;

function syncPreview() {
  const p = $('#preview');
  if (!p) return;
  p.hidden = NARROW.matches ? !previewWanted : false;
  $('#preview-toggle').setAttribute('aria-pressed', NARROW.matches && previewWanted ? 'true' : 'false');
  fitPreview();
}

$('#preview-toggle').addEventListener('click', () => {
  previewWanted = !previewWanted;
  syncPreview();
});
if (NARROW.addEventListener) NARROW.addEventListener('change', syncPreview);
else NARROW.addListener(syncPreview);
if (window.ResizeObserver) new ResizeObserver(fitPreview).observe($('#preview-wrap'));
window.addEventListener('resize', fitPreview);
syncPreview();

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal').hidden) {
    if ($('#sidebar').classList.contains('open')) { closeDrawer(); return; }
    if (NARROW.matches && previewWanted) { previewWanted = false; syncPreview(); return; }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (dirty && !$('#publish').disabled) publish();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    showTab('pages');
    $('#field-search').focus();
    $('#field-search').select();
  }
});

window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- start ------------------------------------------------------- */

function notice(kind, text, actions) {
  const box = el('div', { class: 'callout callout-' + kind },
    icon(kind === 'bad' ? 'alert' : kind === 'warn' ? 'alert' : 'info'),
    el('span', { class: 'grow', text }));
  if (actions) box.appendChild(el('div', { class: 'row' }, actions));
  $('#notices').appendChild(box);
  return box;
}

/* A draft is only offered when it was based on the revision that is live now.
   Offering one built on an older revision would silently undo whatever was
   published in between. */
function offerDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) {}
  if (!d || d.rev !== (state.rev || 0)) { dropDraft(); return; }
  if (same(d.pages, state.pages) && same(d.theme, state.theme) && same(d.custom, state.custom)) {
    dropDraft(); return;
  }
  const when = new Date(d.at || Date.now()).toLocaleString();
  const restore = el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Restore' });
  const discard = el('button', { class: 'btn btn-sm', type: 'button', text: 'Discard' });
  const box = notice('warn', 'Unpublished changes from ' + when + ' were found in this browser.', [restore, discard]);
  restore.addEventListener('click', async () => {
    state.theme = { ...DEFAULT_THEME, ...(d.theme || {}) };
    state.pages = d.pages || {};
    state.custom = d.custom || {};
    state.nav = Array.isArray(d.nav) ? d.nav : [];
    box.remove();
    baked = {}; bakedIndex = {}; bakedImg = {};
    await renderFields(); renderColors(); renderTodos(); renderCustom();
    markDirty();
    toast('Draft restored. Publish when you are happy with it.', 'ok');
  });
  discard.addEventListener('click', () => { dropDraft(); box.remove(); });
}

paintTheme();

onAuthStateChanged(auth, async user => {
  if (!user) {
    $('#view-login').hidden = false;
    $('#view-app').hidden = true;
    return;
  }
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#who').textContent = user.email;
  $('#avatar').textContent = (user.email || '?').slice(0, 1);
  $('#notices').textContent = '';

  // An allowlisted user whose email is unverified can read but not write.
  // Say so plainly rather than letting Publish fail with a permissions error.
  if (user.uid !== OWNER_UID && !user.emailVerified) {
    notice('bad', 'Your email is not verified, so nothing can be published yet. Open People & password to send yourself a link.');
  }

  const sel = $('#page-select');
  sel.textContent = '';
  Object.keys(window.CMS_MAP || {}).forEach(slug => {
    sel.appendChild(el('option', { value: slug, text: window.CMS_MAP[slug].title }));
  });
  buildPageList();

  await guardAsync('Saved content', loadState);
  if (!state) state = { rev: 0, theme: { ...DEFAULT_THEME }, nav: [], pages: {}, custom: {} };
  if (!published) published = clone(state);
  if (loadWarning) notice('warn', loadWarning);

  await guardAsync('Words', renderFields, '#fields');
  guard('Colours', renderColors, '#swatches');
  guard('To do', renderTodos, '#todos');
  guard('Pages', renderCustom, '#custom-list');
  guardAsync('Access', renderAccess, '#access-list');

  dirty = false;
  $('#savebar').hidden = true;
  setStatus(null);
  guard('Draft', offerDraft, '#notices');
});
