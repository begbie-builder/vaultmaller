# 🗄️ Vaultmall

**Your media. Every service. One beautiful, private vault.**

Vaultmall is a gorgeous, flat, minimal front-end for all your media. It reads
folders straight off your computer, pulls in your **Cloudinary** library, syncs
**Google Drive**, and is built to add more services easily. Every account is
completely separate and private — no one's media ever mixes with anyone else's.

- 🖥️ **Local Files** — view a folder on your own computer, 100% in the browser (nothing is uploaded)
- ☁️ **Cloudinary** — up to 25 GB of free media, sorted into your vault
- ▲ **Google Drive** — your Drive photos and videos
- 🔒 **Private by design** — Firebase Auth gates access; every connection you add is stored only in your own browser, never on a server
- 🎨 **Flat, animated, rounded UI** — no glows, no gradients, just clean color

It's a **no-build static website**: plain HTML, CSS, and JavaScript. That makes
it dead simple to host for free on **Cloudflare Pages** with **Firebase** as the
backend.

---

# 🧑‍🏫 Setup — explained like you've never done this before

Follow these steps **in order**. Every step tells you exactly where to click.
Total time: about 20–30 minutes. You do **not** need to know how to code.

Things you'll create (all free):
1. A **Firebase** project (handles logins only — no database needed)
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

> That's the only Firebase feature Vaultmall uses — just logins. There's **no
> database to create and no rules to configure.** Everything each user connects
> (Cloudinary, Google Drive, folders…) is entered inside the website and saved
> privately in that user's own browser.

### 1c. Get your Firebase keys
1. Click the **gear icon ⚙️** (top-left, next to "Project Overview") → **Project settings**.
2. Scroll down to **Your apps**. Click the **</> (web)** icon.
3. Nickname it `vaultmall-web`. **Do NOT** check "Firebase Hosting". Click **Register app**.
4. You'll see a code block with `const firebaseConfig = { ... }`. **Keep this tab open.**

### 1d. Paste the keys into Vaultmall
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

### 2a. Make the account
1. Go to **https://cloudinary.com** and click **Sign up for free**.
2. After signing up you land on the **Dashboard**. Find your **Cloud name**
   (a short word like `dxyz1234`). Write it down — you'll paste it into Vaultmall.

### 2b. Let Vaultmall list your media (turn on "Resource list")
By default Cloudinary hides the list of your files. We flip one switch to let
your vault see media **you tag**:
1. Click the **⚙️ Settings** gear (bottom-left).
2. Go to **Security**.
3. Find **Restricted media types** / **Resource list** and make sure
   **"Resource list"** is **allowed / enabled** (untick it if it's in the
   restricted list). Click **Save**.

> Some Cloudinary plans word this differently. You're looking for the setting
> that controls the public `.../image/list/...` endpoint. If media doesn't show
> up later, this is almost always the switch to check.

### 2c. Tag the media you want in your vault
Vaultmall shows any Cloudinary file carrying the tag **`vaultmall`** (you can
change the tag later in the app).
1. In Cloudinary go to **Media Library**.
2. Upload some photos/videos, or select existing ones.
3. Select them → **Add tag** → type `vaultmall` → apply.

### 2d. *(Optional)* Allow uploads from inside Vaultmall
Want to drag files into Vaultmall itself? Create an **unsigned upload preset**:
1. **Settings → Upload → Upload presets → Add upload preset**.
2. Set **Signing Mode = Unsigned**. Give it a name (e.g. `vaultmall_unsigned`). Save.
3. You'll type this preset name into Vaultmall's Cloudinary settings.

✅ You'll connect Cloudinary from *inside* the app later (just your cloud name).

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
3. It's saved privately in your own browser and Google asks you to approve read-only access.

> Because each person brings their own Client ID, remember to add the site's URL
> (localhost for testing, and your `pages.dev` URL once live) to that Client's
> **Authorized JavaScript origins** in Google Cloud.

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

- **Add storage** — bottom-left sidebar button. Pick a distributor and connect it.
- **Local Files** — click *Choose a folder*, grant read permission, and your
  photos/videos appear instantly. Nothing is uploaded; it reads them live.
- **Sidebar** sorts everything by distributor (Local, Cloudinary, Google Drive…).
- **Search + filters** (top right) narrow by name or Images/Video.
- **Click any item** for a full-screen lightbox (arrow keys to move, `Esc` to close).
- **Theme** — the ◑ button flips dark/light.

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

Already scaffolded and waiting to be wired up: **Dropbox, OneDrive, S3/R2, and
Direct Links**.

---

# 🔐 How your privacy actually works

- **Logins** are handled entirely by **Firebase Authentication**. Vaultmall never
  sees or stores your password.
- **The services you connect are entered inside the website — never in the code —
  and saved only in your own browser** (localStorage), namespaced to your login.
  They never travel to a server, so one user can never reach another's. Sign out,
  or use a different device/browser, and those connections aren't there.
- **Local Files never leave your machine** — the browser reads them directly and
  they're shown from your own device.
- **Cloudinary** only ever needs your **cloud name** (public). Your API *secret*
  is never entered or stored anywhere in Vaultmall.
- **Google Drive** access is **read-only**; you supply your own Client ID and the
  access token lives in memory for the session only — it's never saved.

> ⚖️ **Trade-off to know:** because connections live in your browser, they don't
> sync across devices and are cleared if you wipe browser data. Want them to
> follow your account everywhere instead? That's a one-file change — ask and it
> can be switched to sync privately through your Firebase account.

---

# 🩹 Troubleshooting

| Problem | Fix |
|---|---|
| "Firebase isn't configured" on load | You didn't paste your keys into `js/firebase-config.js` (Step 1d). |
| Login error `auth/unauthorized-domain` | Add your site URL in Firebase → Authentication → Settings → Authorized domains (Step 5c). |
| Blank page / module errors when opening the file | You opened `index.html` directly. Use a local server (Step 4). |
| Local Files button missing | Use Chrome, Edge, or Brave on **desktop**. |
| Cloudinary shows nothing | Turn on **Resource list** (Step 2b) and tag files with `vaultmall` (Step 2c). |
| Google Drive won't connect | Paste your Client ID in the app, add your URL to **Authorized JavaScript origins**, and add yourself as a **Test user** (Step 3). |
| My connections vanished after clearing browser data | Expected — connections live in your browser's localStorage. Just reconnect (or ask to enable account sync). |

---

Made to be forked, hosted, and made yours. Enjoy your vault. 🗄️
