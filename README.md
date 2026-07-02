# 🗄️ Vaultmall

**Your media. Every service. One beautiful, private vault.**

Vaultmall is a **dual-core media hub** with a bespoke, editorial design — deep
slate, teal, mist and mint; soft rounded geometry; zero blur, zero glow, zero
translucency. It reads folders straight off your computer, pulls in your
**Cloudinary** library, and syncs **Google Drive**, **Dropbox**, and **MEGA**.
Every account is completely separate and private.

**The two cores:**

- 📷 **PHOTOS — the personal vault.** A light, printed-archive feel: strict
  masonry walls, a timeline grouped by month, albums, and a selection mode.
- 🎬 **CINEMA — the private screening room.** A dark stage: hero banners,
  horizontal category rows, TMDb-powered posters, ratings (TMDb / IMDb /
  Rotten Tomatoes), cast lists — with Jellyfin-style filename matching and a
  manual "Fix match" override when the guess is wrong. **TV shows too:**
  episodes named `SxxExx`, or living in `Show Name/Season 2/` folders, fold
  into one series card with a season-by-season episode list.
- 🔌 **SOURCES — the switchboard.** One dashboard aggregating every storage
  link into a unified library, with per-service brand marks and live counts.

**Supported sources:** Local Files (100% in-browser), Cloudinary (no tagging
required), Google Drive, Dropbox, MEGA *(beta)* — with OneDrive, S3/R2 and
Direct Links scaffolded. Keys are entered in the website and sync privately
with your account, so your vault follows you to any device.

It's a **no-build static website**: plain HTML, CSS, and JavaScript. That makes
it dead simple to host for free on **Cloudflare Pages** with **Firebase** as the
backend.

---

# 🧑‍🏫 Setup — explained like you've never done this before

Follow these steps **in order**. Every step tells you exactly where to click.
Total time: about 20–30 minutes. You do **not** need to know how to code.

Things you'll create (all free):
1. A **Firebase** project (logins + a tiny private database that syncs your settings across devices)
2. A **Cloudinary** account (your 25 GB of media)
3. *(Optional)* a **Google** OAuth key (to show Google Drive)
4. A **Cloudflare Pages** site (puts your vault online)

---

## STEP 1 — Firebase (logins + your private settings)

### 1a. Create the project
1. Go to **https://console.firebase.google.com** and sign in with a Google account.
2. Click **Add project** (or **Create a project**).
3. Name it `vaultmall` (any name is fine). Click **Continue**.
4. You can turn **Google Analytics off** — you don't need it. Click **Create project**.
5. Wait for it to finish, then click **Continue**.

### 1b. Turn on username + password logins
1. In the left menu click **Build → Authentication**.
2. Click **Get started**.
3. In the **Sign-in method** tab, click **Email/Password**.
4. Flip the first switch **ON** (leave "Email link" off). Click **Save**.

> 💡 Vaultmall lets people log in with a **username**, not an email. Behind the
> scenes it quietly turns `yourname` into `yourname@vaultmall.app` so Firebase is
> happy. You never see this — you just type a username.

### 1c. Create the sync database
Everything a user connects (Cloudinary, Drive, TMDb keys, albums, profile photo,
theme) is saved in one private document per user, so it follows them to any
device they sign into.
1. Left menu → **Build → Firestore Database**.
2. Click **Create database** → **Start in production mode** → pick a location → **Enable**.

### 1d. Publish the security rules (important)
This is what keeps every user's synced data private to them.
1. **Firestore Database → Rules** tab.
2. Delete what's in the box, paste the entire contents of this project's
   **`firestore.rules`** file, and click **Publish**.

### 1e. Get your Firebase keys
1. Click the **gear icon ⚙️** (top-left, next to "Project Overview") → **Project settings**.
2. Scroll down to **Your apps**. Click the **</> (web)** icon.
3. Nickname it `vaultmall-web`. **Do NOT** check "Firebase Hosting". Click **Register app**.
4. You'll see a code block with `const firebaseConfig = { ... }`. **Keep this tab open.**

### 1f. Paste the keys into Vaultmall
1. In this project, open the file **`js/firebase-config.js`**.
2. Replace every `PASTE_...` value with the matching value from Firebase. You only
   need these four — it should end up looking like:
   ```js
   export const firebaseConfig = {
     apiKey: "AIzaSyD...realkey...",
     authDomain: "vaultmall-1234.firebaseapp.com",
     projectId: "vaultmall-1234",
     appId: "1:839201...:web:abc123...",
   };
   ```
3. Save the file.

> 🔐 **These keys are safe to put in a public GitHub repo.** They only *identify*
> the project that handles logins — they don't grant access to anyone's media.

✅ Firebase is done.

---

## STEP 2 — Cloudinary (your 25 GB of media)

**No tagging required — Vaultmall shows everything in your account.** It does this
through a tiny serverless helper (`functions/api/cloudinary.js`) that runs on
*your own* Cloudflare deployment and talks to Cloudinary for you. Nothing to turn
on in Cloudinary, no tags.

### 2a. Make the account & grab three values
1. Go to **https://cloudinary.com** and click **Sign up for free**.
2. On the **Dashboard** (or **Settings → API Keys**), find and copy:
   - **Cloud name** (a short word like `dxyz1234`)
   - **API Key** (a long number)
   - **API Secret** (click to reveal)

### 2b. Connect it *inside the website*
You do **not** put these in any file. Once Vaultmall is running (Steps 4–5):
1. Sign in → **Add storage → Cloudinary**.
2. Paste your **Cloud name**, **API Key**, and **API Secret**. Leave *Folder* blank
   to show everything (or type a folder to show just that one). Click **Connect**.
3. That's it — all your media appears. The values sync privately with your account.

> 🔐 **Why a helper function?** Cloudinary's "list everything" API can't be called
> safely from a plain web page, so the request goes to a small function on your own
> Cloudflare site. Your key/secret travel from your browser to *your* function over
> HTTPS and are never stored on any server.
>
> ⚠️ Cloudinary therefore only loads on your **deployed** site (Step 5), or when you
> run the site locally with `npx wrangler pages dev .` instead of a plain static
> server. On a plain `python -m http.server`, Vaultmall will save your Cloudinary
> settings but show a "Reconnect" button until it's running with functions.

---

## STEP 3 — Google Drive *(optional, skip if you don't use Drive)*

### 3a. Create an OAuth key
1. Go to **https://console.cloud.google.com** and pick/create a project.
2. Left menu → **APIs & Services → Library**. Search **Google Drive API** and click **Enable**.
3. **APIs & Services → OAuth consent screen**: choose **External**, fill the app
   name (`Vaultmall`) and your email, **Save and Continue** through the steps.
   Add yourself as a **Test user**.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
5. Application type: **Web application**.
6. Under **Authorized JavaScript origins**, add:
   - `http://localhost:8000` (for testing on your computer)
   - your Cloudflare URL once you have it, e.g. `https://vaultmall.pages.dev`
7. Click **Create**. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

### 3b. Enter it *inside the website* (not in the code)
You do **not** put this in any file. Once Vaultmall is running:
1. Sign in → **Add storage → Google Drive**.
2. Paste your **Client ID** into the box and click **Connect Google Drive**.
3. It syncs privately with your account, and Google asks you to approve read-only access.

> Because each person brings their own Client ID, remember to add the site's URL
> (localhost for testing, and your `pages.dev` URL once live) to that Client's
> **Authorized JavaScript origins** in Google Cloud.

---

## More distributors *(all optional — connect any, skip the rest)*

### 📦 Dropbox — one-time setup, then one click for everyone
You (the site owner) register ONE Dropbox app; after that, every user connects
with a single click and an approval screen. Nobody generates tokens.

**Owner setup (once):**
1. Go to **https://www.dropbox.com/developers/apps → Create app**.
2. Choose **Scoped access** → **Full Dropbox** → name it after your site.
3. **Permissions** tab: tick **`files.metadata.read`**, **`files.content.read`**,
   **`sharing.write`** and **`sharing.read`** → Submit. (The sharing pair powers
   the built-in video player.)
4. **Settings** tab → **OAuth 2 → Redirect URIs**: add
   - `http://localhost:8000/` (for local testing)
   - `https://YOURSITE.pages.dev/` (your live URL, with the trailing slash)
5. Still on **Settings**, under **Chooser / Saver / Embedder domains**, add your
   domain (e.g. `YOURSITE.pages.dev`) — required for the embedded video player.
6. Copy the **App key** (it's public, like the Firebase keys) into
   `js/firebase-config.js` under `dropboxConfig`.

> Changed permissions later? Reconnect Dropbox in Sources — connections keep the
> permissions they were approved with.

**Users (every time after):** Sources → Dropbox → **Connect Dropbox** → approve →
done. The connection keeps itself alive with a refresh token synced to their
account.

> Dropbox caps un-reviewed apps at 500 connected users, which is plenty for a
> personal site. No App key configured? The old paste-a-token fallback still
> works.

### 🔴 MEGA *(beta)*
MEGA is end-to-end encrypted, so files are decrypted **in your browser** when
shown — great for privacy, but best for smaller folders.
1. In MEGA, right-click a folder → **Share → Get link** → include the **decryption
   key** (choose "Link with key").
2. In Vaultmall: **Add storage → MEGA**, paste the folder link, **Connect**.
3. Images load into your grid; videos and large sets decrypt when you open them.

> MEGA loads its decryption library the first time you use it. If you're offline or
> the folder link has no key, it'll tell you.

---

## STEP 4 — Try it on your own computer first

You can't just double-click `index.html` (browsers block modules from files).
Run a tiny local server:

**If you have Python** (most Macs/Linux do):
```bash
cd vaultmall
python3 -m http.server 8000
```
**If you have Node.js:**
```bash
npx serve -l 8000
```
Then open **http://localhost:8000** in Chrome, Edge, or Brave.

Create an account, and try **Add storage → Local Files** to see the magic. 🎉

> Use **Chrome, Edge, or Brave on desktop** for the Local Files feature — it uses
> a browser capability Safari and Firefox don't fully support yet. Everything
> else works everywhere.

> 💡 **Testing Cloudinary locally?** Cloudinary uses the serverless helper, which a
> plain static server doesn't run. To try it before deploying, use
> `npx wrangler pages dev .` instead of `python -m http.server`, then open the URL
> it prints. Everything else (Local, Google Drive, Dropbox, MEGA) works on a plain
> server too.

---

## STEP 5 — Put it online with GitHub + Cloudflare Pages (free)

### 5a. Get the code on GitHub
If you're reading this in a GitHub repo already, you're done — skip ahead.
Otherwise, create a new repo and upload these files.

### 5b. Deploy on Cloudflare Pages
1. Go to **https://dash.cloudflare.com** and sign up / log in (free).
2. Left menu → **Workers & Pages → Create → Pages → Connect to Git**.
3. Authorize GitHub and pick your **vaultmall** repo.
4. On the build settings screen — **this is important because there's no build:**
   - **Framework preset:** `None`
   - **Build command:** *(leave completely empty)*
   - **Build output directory:** `/` (a single slash)
5. Click **Save and Deploy**. After a minute you'll get a URL like
   `https://vaultmall.pages.dev`.

### 5c. Tell Firebase to trust your new URL
Otherwise logins fail with an "unauthorized domain" error.
1. Firebase → **Authentication → Settings → Authorized domains → Add domain**.
2. Add your Cloudflare domain, e.g. `vaultmall.pages.dev`. Save.

### 5d. *(If you set up Google Drive)* add the URL there too
Google Cloud → **Credentials → your OAuth client → Authorized JavaScript
origins → Add** your `https://vaultmall.pages.dev` URL. Save.

✅ **Done. Your vault is live.** Every push to GitHub auto-redeploys it.

---

# 🎬 Using Vaultmall

**PHOTOS** (light, archival):
- **Timeline** groups everything by month; **Albums** are your own named sets.
- **Select** turns on selection mode — pick tiles, then *Add to album*.
- Filter by Photos/Videos; **click any tile** for the lightbox (arrows / `Esc`).

**CINEMA** (dark, cinematic):
- Videos named like `Title (2019).mkv` or with `SxxExx` land here automatically.
- **TV shows:** name files `Show.S01E02.mkv`, or keep them in folders like
  `TV/Show Name/Season 1/01 - Pilot.mkv` — Vaultmall reads the season folder and
  the folder above it as the show's name, groups every episode under one card,
  and matches the show on TMDb.
- Add a **free TMDb API key** (Sources → *Metadata engine*; get one at
  themoviedb.org → Settings → API). Vaultmall then identifies each file:
  poster, backdrop, rating, genres, cast. An **OMDb key** (omdbapi.com) is
  optional and adds IMDb + Rotten Tomatoes scores.
- Every title opens as its own full page: backdrop, poster, ratings, cast, and
  (for shows) a season-by-season episode list.
- Wrong guess? Open the title → **Fix match** → search TMDb or paste an ID.
- **Playback:** Local, Cloudinary and MEGA files play in Vaultmall's own
  viewer. Dropbox and Google Drive videos play through those services'
  embedded players inside Vaultmall, which transcode server-side, so even
  mkv/x265 movie files play (browsers can't decode those natively).
- Not a film at all? **Not a film → Photos** sends it back to the vault.

**SOURCES** (the switchboard):
- Connect, reload, or manage every storage service; the unified-library bar
  shows how your collection splits across them.

**Profile photo:** click your avatar (top right) to upload one; it's cropped
square and synced with your account. Alt-click removes it.

**SETTINGS** (under your profile menu, top right):
- Theme (Dark default / Light), grid density, which view Photos opens in.
- Playback: slideshow speed, autoplay and loop for videos.
- Account: profile photo, sign out.
- Data: export/import a JSON backup, reset film matches, clear this device.
- The viewer also gained a download button and a slideshow (▶, or spacebar).

> After a reload, **Local Files** and **Google Drive** show a *Reconnect* button.
> That's on purpose — browsers require one click before granting folder access or
> re-opening Google, so Vaultmall never ambushes you with popups on load.

---

# ➕ Adding your own distributor

Vaultmall is built to grow. Every service is one entry in
`js/storage/registry.js` plus a small module in `js/storage/`.

1. Create `js/storage/myservice.js` exporting an async `list(config)` that
   returns an array of media items:
   ```js
   export async function list(config) {
     return [{
       id: "myservice:123",
       title: "beach.jpg",
       type: "image",           // "image" or "video"
       thumbUrl: "https://…",   // small preview
       fullUrl: "https://…",    // full-size for the lightbox
       source: "myservice",
       sub: "My Service",
     }];
   }
   ```
2. Register it in `js/storage/registry.js` with a name, icon, color, and any
   config `fields`. Set `available: true` and remove `soon: true`.

Already scaffolded and waiting to be wired up: **OneDrive, S3/R2, and Direct
Links**. (Local, Cloudinary, Google Drive, Dropbox, and MEGA are fully wired.)

---

# 🔐 How your privacy actually works

- **Logins** are handled entirely by **Firebase Authentication**. Vaultmall never
  sees or stores your password.
- **The services you connect are entered inside the website, never in the code.**
  They're cached in your browser and synced to a private Firestore document that
  only your signed-in account can read or write (that's what `firestore.rules`
  enforces), so your vault follows you across devices without ever being visible
  to anyone else.
- **Local Files never leave your machine** — the browser reads them directly and
  they're shown from your own device.
- **Cloudinary** key/secret stay in your browser and are used only by *your own*
  site's serverless helper to fetch your list — never stored on a server.
- **Google Drive** access is **read-only**; you supply your own Client ID and the
  access token lives in memory for the session only — it's never saved.
- **Dropbox** uses an access token you generate and paste; it's kept only in your
  browser.
- **MEGA** stays end-to-end encrypted: files are decrypted **in your browser** from
  the key in the share link, and nothing is re-uploaded anywhere.

> Clearing browser data only clears the local cache; everything comes back from
> your account the next time you sign in.

---

# 🩹 Troubleshooting

| Problem | Fix |
|---|---|
| "Firebase isn't configured" on load | You didn't paste your keys into `js/firebase-config.js` (Step 1d). |
| Login error `auth/unauthorized-domain` | Add your site URL in Firebase → Authentication → Settings → Authorized domains (Step 5c). |
| Blank page / module errors when opening the file | You opened `index.html` directly. Use a local server (Step 4). |
| Local Files button missing | Use Chrome, Edge, or Brave on **desktop**. |
| Cloudinary shows a "Reconnect" button and won't load | It needs the serverless helper — open your **deployed** site, or run locally with `npx wrangler pages dev .` (not `python -m http.server`). |
| Cloudinary error about API key/secret | Double-check the **API Key** and **API Secret** copied from your dashboard. |
| Google Drive won't connect | Paste your Client ID in the app, add your URL to **Authorized JavaScript origins**, and add yourself as a **Test user** (Step 3). |
| Dropbox says token invalid/expired | Generated tokens are short-lived — generate a fresh one and reconnect. |
| MEGA won't load | Make sure the share link **includes the decryption key**, and keep folders modest (everything decrypts in-browser). |
| Films aren't getting posters/ratings | Add your TMDb key under Sources → Metadata engine. If a file is misidentified, open it and hit **Fix match**. |
| A home video ended up in Films | Open it → **Not a film → Photos**. (Anything named with a year or SxxExx is treated as a film by default.) |
| Settings don't sync across devices | Create the Firestore database and publish `firestore.rules` (Steps 1c–1d). |

---

Made to be forked, hosted, and made yours. Enjoy your vault. 🗄️
