# Turning on the editor

The editor is built and deployed at **https://saibrazier.com/admin/**. It will not let anyone in
until the three steps below are done, because Firebase Auth has no sign-in provider enabled yet.

Everything else — the Firebase project, the database, and the security rules — is already set up.

---

## Step 1 — enable email sign-in

[Authentication → Get started](https://console.firebase.google.com/project/saibrazier/authentication)
→ **Email/Password** → enable it → Save.

Leave "Email link (passwordless sign-in)" **off**.

## Step 2 — create Sai's account **before anything else**

[Authentication → Users → Add user](https://console.firebase.google.com/project/saibrazier/authentication/users).
Use `sai@saibrazier.com` and a temporary password, then have him change it via **Forgot password**
on the sign-in screen.

> **This ordering is security-critical.** Email/password auth lets anyone self-register using the
> public apiKey. A stranger who registers gets an account but matches no rule, so they can write
> nothing — *unless* they register an allowlisted address before Sai does. Creating his account
> first takes the address permanently.

## Step 3 — authorise the domain

[Authentication → Settings → Authorized domains](https://console.firebase.google.com/project/saibrazier/authentication/settings)
→ **Add domain** → `saibrazier.com`.

Firebase only ships `localhost` and `saibrazier.firebaseapp.com` by default. Without this, signing
in from the real site fails with `auth/unauthorized-domain`.

---

## Who can edit

Two addresses, hardcoded in `firestore.rules`:

```
sai@saibrazier.com
mataylor.it@icloud.com
```

To change that list, edit `isAdmin()` in `firestore.rules` and run:

```sh
firebase deploy --only firestore:rules --project saibrazier
```

---

## What Sai can change

| Screen | What it does |
|---|---|
| **Words** | Headings, ledes, mottos, venture descriptions and pull quotes, page by page. Also replaces pictures. |
| **Colours** | The accent and the three venture colours, with live preview. **Publishing is blocked while any colour fails the 4.5:1 readability floor** — the check is real, not advisory. |
| **To do** | The eight open questions. Filling one in replaces the dashed placeholder on the live site and drops its placeholder styling. |
| **Pages** | Add or delete pages. New pages appear in the top menu of every page automatically. |

Nothing goes live until **Publish**. **Discard** throws away everything since the last publish.

---

## How it works, and what that costs

- **Hosting never moved.** The site is still GitHub Pages. Firebase is backend only.
- Public pages read **one Firestore document** per page view over the REST API with plain `fetch`.
  No Firebase SDK ships to visitors — the live site gained about 4 KB, not 100 KB.
- **Everything stays baked into the HTML.** The CMS only overrides it. If Firebase is blocked,
  offline, or over its free quota, the six core pages render exactly as they do today.

### Three limitations worth knowing

**Pages Sai adds have no fallback.** Unlike the six core pages, a page created in the editor exists
only in Firestore. If the free-tier read quota is exhausted (50,000 reads/day) those pages show a
"not found" message. The six core pages are unaffected.

**New pages live at `page.html?p=slug`,** not `/slug`. A static host cannot create files. The clean-URL
alternative is a `404.html` router, which returns an HTTP 404 status — bad for search engines. I chose
the honest 200.

**Images are stored in Firestore, not Cloud Storage,** because Storage now requires the paid Blaze
plan. Uploads are resized in the browser to stay under the document limit. This is fine at this
scale. If you enable Blaze later, moving to real Storage is a contained change.

---

## Security

The repo is public, so the Firebase apiKey in `cms.js` and `admin.js` is world-readable. **That is
normal** — it identifies the project, it does not authorise anything. All authority lives in
`firestore.rules`, which is therefore the entire security boundary.

The rules were rewritten after three independent adversarial reviews all returned *must fix first*.
The findings that shaped them:

- **No Cloud Storage surface at all.** An unconfigured bucket defaults to
  `allow read, write: if request.auth != null`, which is equivalent to `if true` the moment anyone
  can self-register.
- **Images store `mime` + `base64`, never a URL**, so the database cannot be pointed at an
  attacker-controlled host. `image/svg+xml` is never accepted — an SVG from a `data:` URL runs script.
- **Colours are regex-validated as hex.** One malformed value could otherwise render the site unreadable.
- **Monotonic `rev`**, exact key allowlists, and size caps on every write.
- **Content is inserted with `textContent`, never `innerHTML`**, which makes stored XSS structurally
  impossible rather than merely unlikely.
- **The admin frame-busts**, because GitHub Pages cannot send a `frame-ancestors` header and that
  directive is ignored inside a `<meta>` CSP.

Verified from the command line: an unauthenticated write returns `PERMISSION_DENIED`.

### If you want it tighter

The allowlist matches on email. Pinning to Sai's UID instead is strictly stronger — it survives even
if an address is somehow re-registered. Once his account exists:

```sh
firebase auth:export /tmp/u.json --project saibrazier   # find his localId
```

then swap the email check in `isAdmin()` for `request.auth.uid == '<that uid>'` and redeploy.
