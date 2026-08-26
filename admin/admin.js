/* admin.js — the editor Sai actually uses.
 *
 * Security notes that must survive future edits:
 *  - The Firebase config below is PUBLIC by design. It identifies the project;
 *    it does not authorise anything. All authority comes from firestore.rules.
 *  - Content is written and previewed with textContent only. Never innerHTML.
 *  - Images are resized in the browser and stored as base64 inside Firestore,
 *    because Cloud Storage requires the paid Blaze plan on this project.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc
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
// The site's six-item nav lives in the HTML and is never published. This list
// carries ONLY the pages Sai creates, which cms.js appends to the real menu.
const BASE_NAV = [];

let state = null;        // the working copy
let dirty = false;
let baked = {};          // current text baked into the live HTML, per page
let pendingMedia = {};   // slot -> {mime,b64,alt,w,h}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- contrast -------------------------------------------------- */

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

/* ---------- reading what is currently on the site --------------------- */

async function readPage(slug) {
  if (baked[slug]) return baked[slug];
  const out = [];
  try {
    const html = await fetch(`../${slug}.html`, { cache: 'no-store' }).then(r => r.text());
    const dom = new DOMParser().parseFromString(html, 'text/html');
    dom.querySelectorAll('[data-cms]').forEach(el => {
      out.push({
        kind: 'text',
        key: el.getAttribute('data-cms'),
        label: el.getAttribute('data-cms-label') || el.getAttribute('data-cms'),
        text: el.textContent.replace(/\s+/g, ' ').trim(),
        long: el.textContent.trim().length > 90 || el.tagName === 'BLOCKQUOTE'
      });
    });
    dom.querySelectorAll('[data-cms-link]').forEach(el => {
      out.push({
        kind: 'link',
        key: el.getAttribute('data-cms-link'),
        label: el.getAttribute('data-cms-label') || el.getAttribute('data-cms-link'),
        text: el.textContent.replace(/\s+/g, ' ').trim(),
        href: el.getAttribute('href') || ''
      });
    });
    out.meta = {
      title: (dom.querySelector('title') || {}).textContent || '',
      description: (dom.querySelector('meta[name="description"]') || {getAttribute:()=>''}).getAttribute('content') || ''
    };
  } catch (e) { /* offline — nothing to edit */ }
  baked[slug] = out;
  return out;
}

/* ---------- words ----------------------------------------------------- */

async function renderFields() {
  const slug = $('#page-select').value;
  const spec = window.CMS_MAP[slug] || { images: [] };
  const fields = await readPage(slug);
  const saved = (state.pages[slug] || {}).blocks || {};
  const wrap = $('#fields');
  wrap.textContent = '';

  if (!fields.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Nothing editable found on this page.';
    wrap.appendChild(p);
  }

  // page title + description
  const savedMeta = (state.pages[slug] || {}).meta || {};
  const metaHead = document.createElement('h2');
  metaHead.className = 'eyebrow';
  metaHead.style.margin = '0 0 1rem';
  metaHead.textContent = 'Page details';
  wrap.appendChild(metaHead);
  [['title','Browser tab title', false], ['description','Search description', true]].forEach(([k, lab, long]) => {
    const label = document.createElement('label');
    label.className = 'fld';
    const sp = document.createElement('span');
    sp.className = 'fld-label'; sp.textContent = lab;
    label.appendChild(sp);
    const inp = document.createElement(long ? 'textarea' : 'input');
    if (long) inp.rows = 2; else inp.type = 'text';
    inp.value = savedMeta[k] !== undefined ? savedMeta[k] : ((fields.meta || {})[k] || '');
    inp.addEventListener('input', () => {
      state.pages[slug] = state.pages[slug] || {};
      state.pages[slug].meta = state.pages[slug].meta || {};
      state.pages[slug].meta[k] = inp.value;
      markDirty();
    });
    label.appendChild(inp);
    wrap.appendChild(label);
  });

  const savedLinks = (state.pages[slug] || {}).links || {};
  let lastGroup = null;
  fields.forEach(f => {
    const group = f.label.split('—')[0].trim();
    if (group !== lastGroup) {
      lastGroup = group;
      const h = document.createElement('h2');
      h.className = 'eyebrow';
      h.style.margin = '2rem 0 1rem';
      h.textContent = group;
      wrap.appendChild(h);
    }

    const label = document.createElement('label');
    label.className = 'fld';
    const span = document.createElement('span');
    span.className = 'fld-label';
    span.textContent = f.label.split('—').slice(1).join('—').trim() || f.label;
    label.appendChild(span);

    if (f.kind === 'link') {
      const cur = savedLinks[f.key] || {};
      const t = document.createElement('input');
      t.type = 'text';
      t.value = cur.text !== undefined ? cur.text : f.text;
      t.placeholder = 'Link text';
      const u = document.createElement('input');
      u.type = 'text';
      u.value = cur.href !== undefined ? cur.href : f.href;
      u.placeholder = 'https://…';
      u.style.marginTop = '.5rem';
      const warn = document.createElement('span');
      warn.className = 'count';
      function save() {
        state.pages[slug] = state.pages[slug] || {};
        state.pages[slug].links = state.pages[slug].links || {};
        state.pages[slug].links[f.key] = { text: t.value, href: u.value };
        const h = u.value.trim();
        const ok = !h || /^https?:\/\//i.test(h) || /^mailto:/i.test(h) ||
                   /^[A-Za-z0-9._~-]+\.html(\?p=[a-z0-9-]{1,40})?(#[A-Za-z0-9_-]+)?$/.test(h) ||
                   /^#[A-Za-z0-9_-]+$/.test(h);
        warn.textContent = ok ? '' : 'That web address will be ignored. Use https://… , an email, or a page on this site.';
        warn.classList.toggle('over', !ok);
        markDirty();
      }
      t.addEventListener('input', save);
      u.addEventListener('input', save);
      label.appendChild(t); label.appendChild(u); label.appendChild(warn);
      wrap.appendChild(label);
      return;
    }

    const input = document.createElement(f.long ? 'textarea' : 'input');
    if (f.long) input.rows = 3; else input.type = 'text';
    input.value = saved[f.key] !== undefined ? saved[f.key] : f.text;
    input.addEventListener('input', () => {
      state.pages[slug] = state.pages[slug] || { blocks: {}, images: {} };
      state.pages[slug].blocks = state.pages[slug].blocks || {};
      state.pages[slug].blocks[f.key] = input.value;
      markDirty();
    });
    label.appendChild(input);
    wrap.appendChild(label);
  });

  const count = document.createElement('p');
  count.className = 'hint';
  count.style.marginTop = '2rem';
  count.textContent = fields.filter(f => f.kind === 'text').length + ' pieces of text and ' + fields.filter(f => f.kind === 'link').length + ' links on this page.';
  wrap.appendChild(count);

  renderImages(slug, spec);
}

function renderImages(slug, spec) {
  const wrap = $('#images');
  wrap.textContent = '';
  if (!spec.images.length) return;

  const h = document.createElement('h2');
  h.className = 'eyebrow';
  h.style.marginTop = '2rem';
  h.textContent = 'Pictures';
  wrap.appendChild(h);

  spec.images.forEach(im => {
    const row = document.createElement('div');
    row.className = 'img-row';

    const thumb = document.createElement('img');
    thumb.alt = '';
    const savedId = ((state.pages[slug] || {}).images || {})[im.slot];
    if (pendingMedia[im.slot]) {
      thumb.src = `data:${pendingMedia[im.slot].mime};base64,${pendingMedia[im.slot].b64}`;
    } else if (savedId) {
      getDoc(doc(db, 'media', savedId)).then(s => {
        if (s.exists()) thumb.src = `data:${s.data().mime};base64,${s.data().b64}`;
      }).catch(() => {});
    }
    row.appendChild(thumb);

    const side = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'swatch-name';
    name.textContent = im.label;
    side.appendChild(name);

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/jpeg,image/png,image/webp';
    file.style.marginTop = '.6rem';
    const note = document.createElement('span');
    note.className = 'count';

    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      note.textContent = 'Resizing…';
      try {
        const out = await resizeToBase64(f, im.maxW);
        pendingMedia[im.slot] = { ...out, alt: '', slug, slot: im.slot };
        thumb.src = `data:${out.mime};base64,${out.b64}`;
        note.textContent = `Ready — ${Math.round(out.b64.length * 0.75 / 1024)} KB, ${out.w}×${out.h}`;
        markDirty();
      } catch (err) {
        note.textContent = err.message || 'That image could not be read.';
      }
    });

    side.appendChild(file);
    side.appendChild(note);
    row.appendChild(side);
    wrap.appendChild(row);
  });
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

/* ---------- colours --------------------------------------------------- */

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
    const row = document.createElement('div');
    row.className = 'swatch-row';

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = state.theme[s.key];

    const mid = document.createElement('div');
    const nm = document.createElement('span');
    nm.className = 'swatch-name'; nm.textContent = s.name;
    const sb = document.createElement('span');
    sb.className = 'swatch-sub'; sb.textContent = s.sub;
    mid.appendChild(nm); mid.appendChild(sb);

    const hex = document.createElement('input');
    hex.type = 'text'; hex.value = state.theme[s.key];

    function set(v) {
      if (!/^#[0-9a-f]{6}$/i.test(v)) return;
      state.theme[s.key] = v.toUpperCase();
      picker.value = v; hex.value = v.toUpperCase();
      markDirty(); checkContrast(); previewTheme();
    }
    picker.addEventListener('input', () => set(picker.value));
    hex.addEventListener('change', () => set(hex.value.trim()));

    row.appendChild(picker); row.appendChild(mid); row.appendChild(hex);
    wrap.appendChild(row);
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
    const line = document.createElement('div');
    line.textContent = `${t.label}: ${r.toFixed(2)}:1 ${r >= 4.5 ? '✓ passes' : '✗ too faint'}`;
    box.appendChild(line);
  });
  const bad = worst < 4.5;
  box.classList.toggle('bad', bad);
  box.classList.toggle('good', !bad);
  if (bad) {
    const p = document.createElement('div');
    p.textContent = 'Pick a deeper colour — text this faint is hard to read, and publishing is blocked until it passes.';
    box.appendChild(p);
  }
  $('#publish').disabled = bad;
  return !bad;
}

function previewTheme() {
  let el = document.getElementById('cms-theme-preview');
  if (!el) { el = document.createElement('style'); el.id = 'cms-theme-preview'; document.head.appendChild(el); }
  el.textContent = `:root{--venture:${state.theme.accentLight}}` +
    `:root[data-theme="dark"]{--venture:${state.theme.accentDark}}` +
    `@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--venture:${state.theme.accentDark}}}`;
}

/* ---------- to-dos ---------------------------------------------------- */

function renderTodos() {
  const wrap = $('#todos');
  wrap.textContent = '';
  state.pages.__todos = state.pages.__todos || { blocks: {} };
  const store = state.pages.__todos.blocks;

  window.CMS_TODOS.forEach(t => {
    const row = document.createElement('div');
    row.className = 'todo-row';
    const lab = document.createElement('div');
    lab.className = 'swatch-name';
    lab.textContent = t.label;
    if (store[t.key]) lab.classList.add('todo-done');
    row.appendChild(lab);

    if (t.hint) {
      const h = document.createElement('span');
      h.className = 'swatch-sub'; h.textContent = t.hint;
      row.appendChild(h);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.value = store[t.key] || '';
    input.style.cssText = 'width:100%;margin-top:.6rem;padding:.7rem .8rem;border:1px solid var(--border);border-radius:2px;background:var(--surface);color:var(--ink);font-family:var(--font-body);font-size:var(--step-0)';
    input.addEventListener('input', () => { store[t.key] = input.value; markDirty(); });
    row.appendChild(input);
    wrap.appendChild(row);
  });
}

/* ---------- custom pages ---------------------------------------------- */

const RESERVED = ['index', 'about', 'belingo', 'eye-of-faith', 'run2live', 'contact', 'page', 'admin', 'assets'];

function renderCustom() {
  const wrap = $('#custom-list');
  wrap.textContent = '';
  const slugs = Object.keys(state.custom);
  if (!slugs.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'You have not added any pages yet.';
    wrap.appendChild(p);
    return;
  }

  slugs.forEach(slug => {
    const pg = state.custom[slug];
    const box = document.createElement('div');
    box.style.cssText = 'border-top:1px solid var(--border);padding:1.25rem 0;';

    const row = document.createElement('div');
    row.className = 'cp-row';
    row.style.borderTop = '0';
    row.style.padding = '0';

    const n = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'swatch-name'; t.textContent = pg.title || slug;
    const u = document.createElement('span');
    u.className = 'swatch-sub'; u.textContent = 'saibrazier.com/page.html?p=' + slug;
    n.appendChild(t); n.appendChild(u);

    const btns = document.createElement('div');
    btns.className = 'row';
    const edit = document.createElement('button');
    edit.className = 'btn btn-quiet'; edit.type = 'button'; edit.textContent = 'Edit';
    const del = document.createElement('button');
    del.className = 'btn btn-danger'; del.type = 'button'; del.textContent = 'Delete';
    btns.appendChild(edit); btns.appendChild(del);

    row.appendChild(n); row.appendChild(btns);
    box.appendChild(row);

    // --- the edit form, hidden until asked for ---
    const form = document.createElement('div');
    form.hidden = true;
    form.style.marginTop = '1.25rem';

    function field(labelText, value, rows) {
      const l = document.createElement('label');
      l.className = 'fld';
      const sp = document.createElement('span');
      sp.className = 'fld-label'; sp.textContent = labelText;
      l.appendChild(sp);
      const el = document.createElement(rows ? 'textarea' : 'input');
      if (rows) el.rows = rows; else el.type = 'text';
      el.value = value || '';
      l.appendChild(el);
      form.appendChild(l);
      return el;
    }

    const fTitle = field('Title', pg.title);
    const fLede  = field('Opening line', pg.lede, 2);
    const fBody  = field('Body', (pg.sections && pg.sections[0] ? pg.sections[0].body : ''), 8);

    [fTitle, fLede, fBody].forEach(el => el.addEventListener('input', () => {
      pg.title = fTitle.value.trim();
      pg.lede = fLede.value;
      pg.sections = [{ heading: '', body: fBody.value }];
      t.textContent = pg.title || slug;
      // keep the menu label in step with the title
      const navItem = state.nav.find(x => x.href === 'page.html?p=' + slug);
      if (navItem) navItem.label = pg.title || slug;
      markDirty();
    }));

    edit.addEventListener('click', () => {
      form.hidden = !form.hidden;
      edit.textContent = form.hidden ? 'Edit' : 'Done';
    });
    del.addEventListener('click', () => {
      if (!confirm('Delete \u201c' + (pg.title || slug) + '\u201d? This cannot be undone.')) return;
      delete state.custom[slug];
      state.nav = state.nav.filter(x => x.href !== 'page.html?p=' + slug);
      markDirty(); renderCustom();
    });

    box.appendChild(form);
    wrap.appendChild(box);
  });
}

function addCustomPage() {
  const title = $('#np-title').value.trim();
  let slug = $('#np-slug').value.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!title) return alert('Give the page a title.');
  if (!slug) slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return alert('That web address will not work. Use letters, numbers and hyphens.');
  if (RESERVED.includes(slug)) return alert(`“${slug}” is reserved by an existing page. Pick another address.`);
  if (state.custom[slug]) return alert('A page with that address already exists.');
  if (Object.keys(state.custom).length >= 12) return alert('That is as many extra pages as the menu can hold.');

  state.custom[slug] = {
    title,
    lede: $('#np-lede').value.trim(),
    sections: [{ heading: '', body: $('#np-body').value.trim() }]
  };
  if (!state.nav.some(n => n.href === `page.html?p=${slug}`)) {
    state.nav.push({ label: title, href: `page.html?p=${slug}` });
  }
  $('#np-title').value = ''; $('#np-slug').value = '';
  $('#np-lede').value = ''; $('#np-body').value = '';
  markDirty(); renderCustom();
}

/* ---------- publish --------------------------------------------------- */

async function publish() {
  if (!checkContrast()) return;
  const btn = $('#publish');
  btn.disabled = true;
  $('#save-status').textContent = 'Publishing…';
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
    dirty = false;
    $('#save-status').textContent = 'Published — your site is updated';
    setTimeout(() => { if (!dirty) $('#savebar').hidden = true; }, 2500);
  } catch (e) {
    $('#save-status').textContent = 'Could not publish: ' + (e.code || e.message || 'unknown error');
  } finally {
    btn.disabled = false;
  }
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

/* ---------- wiring ---------------------------------------------------- */

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
    err.textContent = 'Could not send a reset email.';
  }
  err.hidden = false;
});

$('#signout').addEventListener('click', () => {
  if (dirty && !confirm('You have unpublished changes. Sign out anyway?')) return;
  signOut(auth);
});

$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(o => o.removeAttribute('aria-current'));
  t.setAttribute('aria-current', 'page');
  $$('.panel').forEach(p => { p.hidden = p.dataset.panel !== t.dataset.tab; });
}));

$('#page-select').addEventListener('change', renderFields);
$('#np-add').addEventListener('click', addCustomPage);
$('#publish').addEventListener('click', publish);
$('#discard').addEventListener('click', async () => {
  if (!confirm('Throw away every change since you last published?')) return;
  pendingMedia = {}; baked = {};
  await loadState();
  await renderFields(); renderColors(); renderTodos(); renderCustom();
  dirty = false; $('#savebar').hidden = true;
});
$('#reset-colors').addEventListener('click', () => {
  state.theme = { ...DEFAULT_THEME };
  renderColors(); markDirty();
});

window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    $('#view-login').hidden = false;
    $('#view-app').hidden = true;
    $('#savebar').hidden = true;
    $('#signout').hidden = true;
    var vs = $('#viewsite'); if (vs) vs.hidden = true;
    $('#who').textContent = '';
    return;
  }
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#signout').hidden = false;
  var vs2 = $('#viewsite'); if (vs2) vs2.hidden = false;
  $('#who').textContent = user.email;

  const sel = $('#page-select');
  sel.textContent = '';
  Object.keys(window.CMS_MAP).forEach(slug => {
    const o = document.createElement('option');
    o.value = slug; o.textContent = window.CMS_MAP[slug].title;
    sel.appendChild(o);
  });

  await loadState();
  await renderFields();
  renderColors();
  renderTodos();
  renderCustom();
  dirty = false;
  $('#savebar').hidden = true;
});
