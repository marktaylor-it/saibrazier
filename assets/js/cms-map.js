/* cms-map.js — page titles, image slots, and the open-questions checklist.
 *
 * TEXT FIELDS ARE NO LONGER LISTED HERE. Every text element in each page carries
 * a data-cms key stamped into the markup, and the admin discovers them by
 * reading the page. A hand-written selector list covered 38 fields out of ~380
 * and drifted every time the markup changed; this covers everything and cannot
 * fall out of sync, because the keys live on the elements themselves.
 *
 * Original header follows.
 *
 * cms-map.js — the single definition of what is editable on this site.
 *
 * Loaded by BOTH the public pages (to apply saved text) and /admin/ (to build
 * the editing form and to read the current baked-in text as the default value).
 * Keeping it in one file means the two can never drift apart.
 *
 * Each entry maps a stable content key to a CSS selector on that page. Adding a
 * new editable field is a one-line change here — no HTML edits, no data-
 * attributes sprinkled through the markup.
 *
 * `label` is what Sai sees in the admin. `multiline` renders a textarea.
 */
window.CMS_MAP = {

  index: {
    title: 'Home',
    fields: [],   // discovered from data-cms in the page
    images: [
      { slot: 'portrait.home', label: 'Home portrait', sel: '.portrait img', maxW: 1600 }
    ]
  },

  about: {
    title: 'About',
    fields: [],   // discovered from data-cms in the page
    images: [
      { slot: 'portrait.studio', label: 'Suit portrait', sel: '.print img', maxW: 1400 }
    ]
  },

  belingo: {
    title: 'BeLingo',
    fields: [],   // discovered from data-cms in the page
    images: [
      { slot: 'logo.belingo', label: 'BeLingo logo', sel: '.plate--belingo img', maxW: 960 }
    ]
  },

  'eye-of-faith': {
    title: 'Eye of Faith',
    fields: [],   // discovered from data-cms in the page
    images: [
      { slot: 'logo.eof',   label: 'Eye of Faith mark', sel: '.plate--eof img', maxW: 800 },
      { slot: 'banner.eof', label: 'Eye of Faith banner', sel: '#eof-banner', maxW: 1600 }
    ]
  },

  run2live: {
    title: 'run2live',
    fields: [],   // discovered from data-cms in the page
    images: [
      { slot: 'logo.r2l', label: 'run2live mark', sel: '.plate--r2l img', maxW: 640 }
    ]
  },

  contact: {
    title: 'Contact',
    fields: [],   // discovered from data-cms in the page
    images: []
  },

  'business-ventures': {
    title: 'Business ventures',
    fields: [],   // discovered from data-cms in the page
    images: []
  },

  publications: {
    title: 'Publications',
    fields: [],   // discovered from data-cms in the page
    images: []
  },

  podcasts: {
    title: 'Podcasts',
    fields: [],   // discovered from data-cms in the page
    images: []
  }
};

/* The eight open questions, surfaced as their own checklist screen. Filling one
   in replaces the dashed placeholder chip on the live site. */
window.CMS_TODOS = [
  { key: 'todo.eof.stream', sel: '#todo-eof-stream',   page: 'eye-of-faith', label: 'Eye of Faith streaming URL',
    hint: 'Spotify, Apple Podcasts or YouTube. The Listen section has nowhere to send people until this exists.' },
  { key: 'todo.eof.launch', sel: '#todo-eof-launch',   page: 'eye-of-faith', label: 'When the podcast launched', hint: 'e.g. Mar 2026' },
  { key: 'todo.r2l.services', sel: '#todo-r2l-mission', page: 'run2live',     label: 'What run2live offers',
    hint: 'Format, who it is for, remote or in person around Rexburg.' },
  { key: 'todo.r2l.founded', sel: '#todo-r2l-founded',  page: 'run2live',     label: 'When run2live started', hint: 'e.g. Jun 2025' },
  { key: 'todo.r2l.taking', sel: '#todo-r2l-taking',   page: 'run2live',     label: 'Taking new athletes right now?', hint: 'Yes or no' },
  { key: 'todo.edu.major', sel: '#todo-edu',    page: 'about',        label: 'BYU–Idaho major and graduation year' },
  { key: 'todo.belingo.partners', sel: '#todo-belingo-partners', page: 'belingo',  label: 'BeLingo partner institutions',
    hint: 'Only ones that have agreed to be named publicly.' },
  { key: 'todo.officer', sel: '#todo-officer',      page: 'about',        label: 'Officer role — organisation and title' }
];
