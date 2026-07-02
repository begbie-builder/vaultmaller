// ============================================================
//  Distributor: Dropbox
//  Two ways in:
//  1) One-click OAuth (the Infuse way): the site owner registers
//     ONE Dropbox app and puts its public App key in
//     firebase-config.js. Users then just click Connect and
//     approve — PKCE means no secret and no user-made tokens.
//     We keep the refresh token (synced with the account) and
//     mint short-lived access tokens from it as needed.
//  2) Fallback: a manually generated access token, for owners
//     who never set an App key.
//  Temporary, streamable links are fetched per file for viewing.
// ============================================================
import { dropboxConfig, isDropboxConfigured } from "../firebase-config.js";

const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const VERIFIER_KEY = "vaultmall:dbx-verifier";

export const oauthReady = isDropboxConfigured();

// ---- PKCE helpers ----
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(str) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
}
function randomVerifier() {
  const a = new Uint8Array(48);
  crypto.getRandomValues(a);
  return b64url(a.buffer);
}
const redirectUri = () => location.origin + location.pathname;

// Send the user to Dropbox's consent page. We come back with ?code=…
export async function beginAuth() {
  if (!oauthReady) throw new Error("Dropbox one-click isn't set up on this site.");
  const verifier = randomVerifier();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = b64url(await sha256(verifier));
  const q = new URLSearchParams({
    client_id: dropboxConfig.appKey,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri(),
    token_access_type: "offline", // gives us a refresh token that keeps working
    // Ask for exactly what we need; fails loudly at consent time if the
    // app's Permissions tab doesn't have these ticked.
    scope: "files.metadata.read files.content.read sharing.write sharing.read",
  });
  location.href = `https://www.dropbox.com/oauth2/authorize?${q}`;
}

export function hasPendingAuth() {
  return !!(new URLSearchParams(location.search).get("code") && sessionStorage.getItem(VERIFIER_KEY));
}

// Called after Dropbox redirects back: swap the code for tokens.
export async function completeAuth() {
  const code = new URLSearchParams(location.search).get("code");
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  history.replaceState(null, "", location.pathname + location.hash);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      code_verifier: verifier,
      client_id: dropboxConfig.appKey,
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) throw new Error("Dropbox sign-in failed. Check the App key and redirect URI in your Dropbox app.");
  const d = await res.json();
  cached = { token: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000, refresh: d.refresh_token };
  return { refreshToken: d.refresh_token };
}

// Short-lived access tokens, minted from the stored refresh token.
let cached = { token: null, exp: 0, refresh: null };
async function accessTokenFor(config) {
  if (config.accessToken) return config.accessToken; // legacy manual token
  if (!config.refreshToken) throw new Error("Connect Dropbox first.");
  if (cached.token && cached.refresh === config.refreshToken && Date.now() < cached.exp) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      client_id: dropboxConfig.appKey,
    }),
  });
  if (!res.ok) throw new Error("Dropbox session expired. Reconnect Dropbox in Sources.");
  const d = await res.json();
  cached = { token: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000, refresh: config.refreshToken };
  return cached.token;
}

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "heic"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv", "avi", "mkv"];

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}
const isImage = (n) => IMAGE_EXT.includes(extOf(n));
const isVideo = (n) => VIDEO_EXT.includes(extOf(n));
const isMedia = (n) => isImage(n) || isVideo(n);

// Run async work over a list with limited concurrency.
async function pool(items, limit, worker) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]).catch(() => null);
    }
  });
  await Promise.all(runners);
  return out;
}

async function rpc(token, endpoint, body) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("Dropbox session is invalid or expired. Reconnect Dropbox in Sources.");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (/not permitted to access this endpoint|required scope/i.test(text)) {
      throw new Error(
        "Your Dropbox app is missing permissions. In the Dropbox App Console open the Permissions tab, tick files.metadata.read, files.content.read, sharing.write and sharing.read, click Submit, then RECONNECT here (existing connections keep their old permissions)."
      );
    }
    throw new Error(`Dropbox error ${res.status}. ${text.slice(0, 120)}`);
  }
  return res.json();
}

// ---- Embedded player ----
// Browsers can't decode most movie files (mkv / x265), so videos play
// through Dropbox's own embedded previewer, which transcodes server-side
// and plays basically anything. It needs a shared link per file and the
// site's domain added under "Chooser / Embedder domains" in the App
// Console.
async function rpcTry(token, endpoint, body) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let data = {};
  try { data = JSON.parse(text); } catch { /* keep raw */ }
  return { ok: res.ok, status: res.status, data, text };
}

async function sharedLinkFor(token, path) {
  let r = await rpcTry(token, "sharing/create_shared_link_with_settings", { path });
  if (r.ok) return r.data.url;
  if (r.text.includes("shared_link_already_exists")) {
    r = await rpcTry(token, "sharing/list_shared_links", { path, direct_only: true });
    if (r.ok && r.data.links && r.data.links[0]) return r.data.links[0].url;
  }
  if (/not permitted|required scope/i.test(r.text)) {
    throw new Error("Playback needs the sharing permissions. In the Dropbox App Console Permissions tab tick sharing.write and sharing.read, Submit, then reconnect Dropbox.");
  }
  throw new Error("Couldn't get a Dropbox share link for playback.");
}

let dropinsPromise = null;
function loadDropins() {
  if (window.Dropbox && window.Dropbox.embed) return Promise.resolve();
  if (!dropinsPromise) {
    dropinsPromise = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://www.dropbox.com/static/api/2/dropins.js";
      sc.id = "dropboxjs";
      sc.dataset.appKey = dropboxConfig.appKey;
      sc.onload = () => resolve();
      sc.onerror = () => { dropinsPromise = null; reject(new Error("Couldn't load the Dropbox player.")); };
      document.head.appendChild(sc);
    });
  }
  return dropinsPromise;
}

// Mount Dropbox's previewer for `path` inside `element`.
export async function embedInto(element, config, path) {
  const token = await accessTokenFor(config);
  const link = await sharedLinkFor(token, path);
  await loadDropins();
  element.innerHTML = "";
  window.Dropbox.embed({ link }, element);
}

// config: { refreshToken } (one-click) or { accessToken } (manual fallback)
export async function list(config) {
  const token = await accessTokenFor(config);
  const path = config.folder ? (config.folder.startsWith("/") ? config.folder : "/" + config.folder) : "";

  const entries = [];
  let data = await rpc(token, "files/list_folder", { path, recursive: true, limit: 2000 });
  entries.push(...(data.entries || []));
  let guard = 0;
  while (data.has_more && guard++ < 20) {
    data = await rpc(token, "files/list_folder/continue", { cursor: data.cursor });
    entries.push(...(data.entries || []));
  }

  const media = entries.filter((e) => e[".tag"] === "file" && isMedia(e.name));

  const items = await pool(media, 6, async (e) => {
    const link = await rpc(token, "files/get_temporary_link", { path: e.path_lower });
    const type = isImage(e.name) ? "image" : "video";
    return {
      id: `dropbox:${e.id}`,
      title: e.name,
      type,
      thumbUrl: type === "image" ? link.link : "",
      fullUrl: link.link,
      source: "dropbox",
      sub: "Dropbox",
      path: e.path_lower,
      date: e.server_modified ? Date.parse(e.server_modified) : 0,
    };
  });

  return items.filter(Boolean);
}
