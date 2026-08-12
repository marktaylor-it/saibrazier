# saibrazier

Personal website for **Sai Brazier** — entrepreneur, podcaster, writer, athlete, man of faith.

Six hand-written pages, one stylesheet. No framework, no build step, no npm, no CDN. It works
offline and from any static host.

**Live:** https://mataylorit-dev.github.io/saibrazier/

---

## Run it locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

That is the whole toolchain. Edit an `.html` file, save, refresh.

---

## Structure

```
index.html          Home — masthead + the three-venture ledger
about.html          Full portrait, record, education
belingo.html        EdTech venture
eye-of-faith.html   Podcast + the poem, set as live text
run2live.html       Endurance coaching
contact.html        Email, Instagram, LinkedIn
assets/css/site.css The entire stylesheet
assets/img/         Web-ready images (originals are NOT in the repo — see below)
.nojekyll           Stops GitHub Pages running the files through Jekyll
```

### Light and dark

The site ships both. The toggle in the header cycles **Auto → Light → Dark**, and the choice is
saved to `localStorage`. "Auto" means no `data-theme` attribute at all, so the OS preference decides.

Two things to know before editing theme colors:

- The dark declarations in `site.css` are written **twice** — once inside
  `@media (prefers-color-scheme: dark)` for visitors following their OS, once under
  `:root[data-theme="dark"]` for visitors who picked dark. CSS cannot share one block between a
  media query and an attribute selector. **Change one, change the other.**
- The snippet in each page's `<head>` must stay **inline and synchronous**. Moving it to an external
  file makes the page paint the wrong theme for a frame before correcting itself.

The button is `hidden` in the HTML and revealed by `theme.js`, so a visitor with JS disabled never
sees a dead control — they simply get their OS preference.

### Two rules that will break the site if ignored

1. **Every path must stay relative** (`assets/img/x.jpg`, `about.html`). The site is served from a
   subpath, so a root-absolute path like `/assets/img/x.jpg` works in local preview and 404s in
   production. Check with:
   ```sh
   grep -rE '(href|src)="/' *.html    # must print nothing
   ```
2. **The anti-drift rules** are written at the top of `site.css`. They are what keep this from
   looking like a template. Read them before restyling anything.

---

## Editing content

Unconfirmed facts ship as visible `[[TODO: …]]` fields rather than invented text. Find them all:

```sh
grep -rn 'TODO:' *.html
```

Replace the whole `<span class="todo">…</span>` with real text as answers come in. See
**Open questions** below.

---

## Images

`assets/img/` holds downscaled, web-ready derivatives. The full-resolution originals are **not** in
the repo (they run to ~30 MB; the studio headshot alone is 13230×8604). They live outside it, and
the derivatives were produced with `sips`:

```sh
sips -s format jpeg -s formatOptions 80 --resampleWidth 1200 SOURCE.jpg --out portrait-outdoor.jpg
sips -s format png  --resampleWidth 1600 SOURCE.png --out eof-banner.png
```

**Two hard caps.** No high-resolution version of either mark exists, so never display them larger
than the CSS already allows:

| Asset | Native | Never exceed |
|---|---|---|
| `belingo-wordmark.jpg` | 1135×473 | 480 CSS px |
| `run2live-mark.png` | 480×480 | 320 CSS px |

Getting vector or high-res versions of those two logos from Sai is the single biggest available
upgrade to the site's polish.

---

## Deploying

Already live at the URL above. To redeploy, commit and push to `main` — Pages rebuilds in about a
minute.

### Moving it to Sai's own account

The site is built to be handed over. Two options:

**Transfer the repo** (keeps history and issues) — Settings → General → Danger Zone → Transfer
ownership → `saibrazier`. Renaming it to `saibrazier.github.io` on his account makes it his user
site at `https://saibrazier.github.io/` automatically.

**Or use the custom domain.** `saibrazier.com` is already registered and routes email through
iCloud, but hosts no website — it has MX records and no A record. Pointing it here will **not**
disturb his email:

1. Add a file named `CNAME` at the repo root containing exactly `saibrazier.com`
2. At the domain registrar, add the four GitHub Pages A records for the apex
   (`185.199.108.153`, `.109.153`, `.110.153`, `.111.153`) plus an AAAA set, and a `CNAME` on
   `www` pointing at `mataylorit-dev.github.io`
3. Settings → Pages → Custom domain → `saibrazier.com` → Enforce HTTPS

Leave the existing MX records alone and mail keeps working.

---

## Open questions for Sai

Highest value first. The site works without these; each one makes it better.

1. **Eye of Faith streaming URL** — Spotify, Apple Podcasts, YouTube, or an RSS feed. Right now the
   "Listen" section has nowhere to send people, which is the weakest moment on the site.
2. **run2live: what does it actually offer, and is he taking athletes?** Services, format, who it is
   for, and whether coaching is remote or local to Rexburg. This is the thinnest of the three pages.
3. **Officer role** — which organization, what title, what dates.
4. Is Eye of Faith the same podcast he produced on his service mission, or a separate show?
5. BYU–Idaho major and expected graduation. Is he still a student?
6. BeLingo — nameable partner institutions, a public URL, and one approved sentence describing what
   it offers and to whom.
7. Any published writing to link from "writer" — he claims the identity but nothing was supplied.
8. Founding dates for Eye of Faith and run2live.
