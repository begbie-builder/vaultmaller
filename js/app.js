// ============================================================
//  Vaultmall — main application
//  Cinema first: one floating frame, a sidebar, and a category
//  picker that swaps between MOVIES / TV SHOWS / PHOTOS /
//  SOURCES. Favorites, resume points and notifications ride
//  along with the account.
// ============================================================
import { isConfigured } from "./firebase-config.js";
import { providerList, getProvider } from "./storage/registry.js";
import * as store from "./store.js";
import * as albums from "./albums.js";
import * as F from "./films.js";
import { BRAND, logoBlock, glyphSvg } from "./logos.js";

// Firebase loads lazily so a slow CDN never blanks the UI.
let FB = null;

// ---------- DOM helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const show = (sel) => $(sel).classList.remove("hidden");
const hide = (sel) => $(sel).classList.add("hidden");
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- State ----------
const state = {
  user: null,
  profile: { username: "user", connections: {} },
  bySource: {},
  media: [],
  needsReconnect: {},
  // movies | tv | favorites | recent | trending | photos | sources | settings | help
  env: "movies",
  genre: "All",
  search: "",
  authMode: "login",
  notifs: [],

  photos: { mode: "timeline", type: "all", albumId: null, selecting: false, selected: new Set() },
  albums: [],
  _visible: [],

  films: { store: { matches: {}, include: [], exclude: [], favs: [] }, matching: false },
  meta: { tmdb: "", omdb: "" },
};

// which envs render inside the cinema section
const CINEMA_ENVS = ["movies", "tv", "favorites", "recent", "trending"];
const CAT_LABELS = { movies: "Movies", tv: "TV Shows", photos: "Photos", sources: "Sources" };

// ---- Account sync ----
// Everything personal (connections, keys, matches, albums, avatar,
// theme) lives in one private Firestore doc so it follows the account
// across devices. localStorage stays the fast local cache; writes get
// debounced up to the cloud.
let syncTimer = null;
function pushSync() {
  if (!FB || !state.user || typeof FB.saveUserData !== "function") return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    FB.saveUserData(state.user.uid, {
      username: state.profile.username,
      connections: state.profile.connections || {},
      meta: state.meta,
      films: state.films.store,
      albums: state.albums,
      avatar: localStorage.getItem(avatarKey(state.user.uid)) || null,
    }).catch(() => {}); // offline or rules not published yet: local still works
  }, 900);
}

// ---- Theme ----
function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = t;
  localStorage.setItem("vaultmall:theme", t);
  const sw = $("#theme-mode");
  if (sw) {
    $$(".sw-opt", sw).forEach((o) => o.classList.toggle("is-active", o.dataset.mode === t));
    if (sw._position) requestAnimationFrame(sw._position);
  }
}

// Per-user profile photo, a small data-URL cached in the browser.
const avatarKey = (uid) => `vaultmall:avatar:${uid}`;

function renderAvatar() {
  const dataUrl = state.user ? localStorage.getItem(avatarKey(state.user.uid)) : null;
  const img = $("#avatar-img");
  const initial = $("#user-avatar");
  if (dataUrl) {
    img.src = dataUrl;
    img.classList.remove("hidden");
    initial.classList.add("hidden");
  } else {
    img.classList.add("hidden");
    initial.classList.remove("hidden");
  }
}

function wireAvatar() {
  const input = $("#avatar-input");
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = () => {
        // Center-crop to a small square so localStorage stays light.
        const S = 128;
        const c = document.createElement("canvas");
        c.width = S; c.height = S;
        const side = Math.min(im.width, im.height);
        c.getContext("2d").drawImage(im, (im.width - side) / 2, (im.height - side) / 2, side, side, 0, 0, S, S);
        localStorage.setItem(avatarKey(state.user.uid), c.toDataURL("image/jpeg", 0.85));
        renderAvatar();
        pushSync();
        toast("Profile photo updated", "", "ok");
      };
      im.onerror = () => toast("Couldn't read that image", "", "err");
      im.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- Settings (synced inside meta) ----
const SETTINGS_DEFAULTS = {
  density: "comfy",      // comfy | compact
  defaultView: "timeline", // timeline | albums
  slideshow: 5,          // seconds per slide
  autoplay: true,
  loop: false,
};
function getSettings() {
  return { ...SETTINGS_DEFAULTS, ...(state.meta.settings || {}) };
}
function saveSettings(patch) {
  state.meta.settings = { ...getSettings(), ...patch };
  if (state.user) { saveMeta(state.user.uid, state.meta); pushSync(); }
  applySettings();
}
function applySettings() {
  const st = getSettings();
  document.body.dataset.density = st.density;
  // reflect current values in every settings switch
  const map = {
    "theme-mode": document.body.dataset.theme,
    "density-mode": st.density,
    "defview-mode": st.defaultView,
    "slide-mode": String(st.slideshow),
    "autoplay-mode": st.autoplay ? "on" : "off",
    "loop-mode": st.loop ? "on" : "off",
  };
  for (const [id, val] of Object.entries(map)) {
    const sw = $("#" + id);
    if (!sw) continue;
    $$(".sw-opt", sw).forEach((o) => o.classList.toggle("is-active", o.dataset.mode === val));
    if (sw._position) requestAnimationFrame(sw._position);
  }
}

// Per-user metadata keys (TMDb/OMDb) — browser-only, like everything else.
const metaKey = (uid) => `vaultmall:meta:${uid}`;
function loadMeta(uid) {
  try { return JSON.parse(localStorage.getItem(metaKey(uid))) || { tmdb: "", omdb: "" }; }
  catch { return { tmdb: "", omdb: "" }; }
}
function saveMeta(uid, meta) { localStorage.setItem(metaKey(uid), JSON.stringify(meta)); }

// ============================================================
//  Boot
// ============================================================
window.addEventListener("DOMContentLoaded", () => {
  applyTheme(localStorage.getItem("vaultmall:theme") || "dark");
  setTimeout(() => $("#splash").classList.add("gone"), 950);
  setTimeout(() => $("#splash").classList.add("hidden"), 1600);

  showAuth();
  wireAuthUI();
  wireAppUI();
  bootFirebase();

  if (location.hash.includes("debug")) {
    window.__vm = { state, refreshEnv, setEnv, enterApp, renderPhotos, renderCinema, renderSources };
  }
});

async function bootFirebase() {
  if (!isConfigured()) {
    showAuthError("⚙ Open js/firebase-config.js and paste your Firebase keys (README Step 1), then reload.");
    $("#auth-submit").disabled = true;
    return;
  }
  try {
    FB = await import("./firebase.js");
    FB.initFirebase();
  } catch (e) {
    showAuthError(
      e && e.message && !/Failed to fetch|import/.test(e.message)
        ? e.message
        : "Couldn't reach Firebase. Check your connection and reload."
    );
    $("#auth-submit").disabled = true;
    return;
  }

  FB.watchAuth(async (user) => {
    if (user) {
      state.user = user;
      // Pull the account's synced copy first; it wins over this browser.
      try {
        const remote = (await FB.loadUserData(user.uid)) || {};
        if (remote.connections) store.hydrate(user.uid, remote.connections);
        if (remote.albums) albums.hydrate(user.uid, remote.albums);
        if (remote.films) F.saveFilmStore(user.uid, remote.films);
        if (remote.meta) saveMeta(user.uid, remote.meta);
        if (remote.avatar) localStorage.setItem(avatarKey(user.uid), remote.avatar);
      } catch { /* no database yet or offline: run on the local cache */ }
      state.profile = { username: FB.usernameOf(user), connections: store.loadConnections(user.uid) };
      state.albums = albums.loadAlbums(user.uid);
      state.films.store = F.loadFilmStore(user.uid);
      state.meta = loadMeta(user.uid);
      if (state.meta.theme) applyTheme(state.meta.theme);
      applySettings();
      enterApp();
      finishDropboxAuth();
    } else {
      state.user = null;
      showAuth();
    }
  });
}

// Complete a one-click Dropbox connection if we just came back
// from their consent page with a code in the URL.
async function finishDropboxAuth() {
  const p = getProvider("dropbox");
  if (!p || !p.module.oauthReady || !p.module.hasPendingAuth()) return;
  try {
    const cfg = await p.module.completeAuth();
    store.saveConnection(state.user.uid, "dropbox", cfg);
    state.profile.connections.dropbox = cfg;
    pushSync();
    toast("Dropbox connected", "", "ok");
    await loadSource("dropbox");
    refreshEnv();
  } catch (e) {
    toast("Dropbox", e.message, "err");
  }
}

// ============================================================
//  Auth
// ============================================================
function showAuth() {
  show("#auth-screen");
  hide("#app");
  requestAnimationFrame(() => $$("#auth-screen .rv").forEach((n) => n.classList.add("in")));
}
function showAuthError(msg) {
  const box = $("#auth-error");
  box.textContent = msg;
  box.classList.remove("hidden");
}
function clearAuthError() { $("#auth-error").classList.add("hidden"); }

function wireAuthUI() {
  const tabs = $(".auth-tabs");
  $$(".auth-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      state.authMode = tab.dataset.mode;
      $$(".auth-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      tabs.dataset.side = state.authMode;
      $(".btn-label").textContent = state.authMode === "login" ? "Sign in" : "Create account";
      $("#auth-password").autocomplete = state.authMode === "login" ? "current-password" : "new-password";
      clearAuthError();
    })
  );

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAuthError();
    const username = $("#auth-username").value.trim();
    const password = $("#auth-password").value;
    const btn = $("#auth-submit");
    btn.disabled = true;
    $(".btn-label").textContent = "One moment";
    try {
      if (state.authMode === "login") await FB.logIn(username, password);
      else await FB.signUp(username, password);
    } catch (err) {
      showAuthError(FB.friendlyAuthError(err));
      btn.disabled = false;
      $(".btn-label").textContent = state.authMode === "login" ? "Sign in" : "Create account";
    }
  });
}

// ============================================================
//  App shell
// ============================================================
function enterApp() {
  hide("#auth-screen");
  show("#app");
  const name = state.profile.username || "user";
  $("#user-name").textContent = name;
  $("#user-avatar").textContent = name.slice(0, 1).toUpperCase();
  renderAvatar();
  state.photos.mode = getSettings().defaultView;
  $("#settings-username").textContent = name;
  loadNotifs();
  setEnv("movies");
  loadAllMedia();
}

function wireAppUI() {
  $("#brand-home").addEventListener("click", () => setEnv("movies"));
  wireAvatar();
  wireUserMenu();
  wireCatPicker();
  wireNotifs();

  $$(".snav-item").forEach((b) => b.addEventListener("click", () => setEnv(b.dataset.nav)));

  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) setEnv(go.dataset.goto);
  });

  $("#search-input").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    $("#search-clear").classList.toggle("hidden", !state.search);
    refreshEnv();
  });
  $("#search-clear").addEventListener("click", () => {
    $("#search-input").value = "";
    state.search = "";
    hide("#search-clear");
    refreshEnv();
    $("#search-input").focus();
  });

  // genre chip rail arrows
  const chips = $("#chips");
  $("#chips-prev").addEventListener("click", () => chips.scrollBy({ left: -chips.clientWidth * 0.7, behavior: "smooth" }));
  $("#chips-next").addEventListener("click", () => chips.scrollBy({ left: chips.clientWidth * 0.7, behavior: "smooth" }));

  // Photos toolbar
  wireSwitch($("#ph-mode"), (v) => { state.photos.mode = v; state.photos.albumId = null; renderPhotos(); });
  wireSwitch($("#ph-type"), (v) => { state.photos.type = v; renderPhotos(); });
  $("#ph-select-btn").addEventListener("click", toggleSelectMode);
  $("#sel-cancel-btn").addEventListener("click", exitSelectMode);
  $("#sel-album-btn").addEventListener("click", openAlbumPicker);

  // Modals
  $$("[data-close-config]").forEach((b) => b.addEventListener("click", () => hide("#config-modal")));
  $$("[data-close-match]").forEach((b) => b.addEventListener("click", () => hide("#match-modal")));
  $("#config-modal").addEventListener("click", (e) => { if (e.target.id === "config-modal") hide("#config-modal"); });
  $("#match-modal").addEventListener("click", (e) => { if (e.target.id === "match-modal") hide("#match-modal"); });
  $("#film-modal").addEventListener("click", (e) => { if (e.target.id === "film-modal") hide("#film-modal"); });

  // Lightbox
  $("[data-close-lightbox]").addEventListener("click", closeLightbox);
  $("#lb-slideshow").addEventListener("click", toggleSlideshow);
  $("[data-lb-prev]").addEventListener("click", () => stepLightbox(-1));
  $("[data-lb-next]").addEventListener("click", () => stepLightbox(1));
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (!$("#lightbox").classList.contains("hidden")) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") stepLightbox(-1);
      if (e.key === "ArrowRight") stepLightbox(1);
      if (e.key === " " && e.target === document.body) { e.preventDefault(); toggleSlideshow(); }
    } else if (e.key === "Escape") {
      hide("#film-modal"); hide("#match-modal"); hide("#config-modal");
    }
  });

  // Settings controls
  wireSwitch($("#theme-mode"), (v) => {
    applyTheme(v);
    state.meta.theme = v;
    if (state.user) { saveMeta(state.user.uid, state.meta); pushSync(); }
  });
  wireSwitch($("#density-mode"), (v) => saveSettings({ density: v }));
  wireSwitch($("#defview-mode"), (v) => { saveSettings({ defaultView: v }); state.photos.mode = v; });
  wireSwitch($("#slide-mode"), (v) => saveSettings({ slideshow: +v }));
  wireSwitch($("#autoplay-mode"), (v) => saveSettings({ autoplay: v === "on" }));
  wireSwitch($("#loop-mode"), (v) => saveSettings({ loop: v === "on" }));

  $("#set-avatar-btn").addEventListener("click", () => $("#avatar-input").click());
  $("#del-avatar-btn").addEventListener("click", () => {
    localStorage.removeItem(avatarKey(state.user.uid));
    renderAvatar();
    pushSync();
    toast("Profile photo removed", "", "ok");
  });
  $("#settings-logout").addEventListener("click", () => FB && FB.logOut());

  $("#reset-matches-btn").addEventListener("click", () => {
    if (!confirm("Clear every film match and let TMDb try again?")) return;
    state.films.store = { ...state.films.store, matches: {} };
    F.saveFilmStore(state.user.uid, state.films.store);
    pushSync();
    toast("Matches cleared", "Open Cinema to re-identify.", "ok");
  });

  $("#export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({
      connections: state.profile.connections,
      meta: state.meta,
      films: state.films.store,
      albums: state.albums,
      avatar: localStorage.getItem(avatarKey(state.user.uid)) || null,
    }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vaultmall-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#import-btn").addEventListener("click", () => $("#import-input").click());
  $("#import-input").addEventListener("change", () => {
    const file = $("#import-input").files && $("#import-input").files[0];
    $("#import-input").value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (d.connections) { store.hydrate(state.user.uid, d.connections); state.profile.connections = d.connections; }
        if (d.albums) { albums.hydrate(state.user.uid, d.albums); state.albums = d.albums; }
        if (d.films) { F.saveFilmStore(state.user.uid, d.films); state.films.store = d.films; }
        if (d.meta) { saveMeta(state.user.uid, d.meta); state.meta = d.meta; }
        if (d.avatar) localStorage.setItem(avatarKey(state.user.uid), d.avatar);
        renderAvatar();
        if (state.meta.theme) applyTheme(state.meta.theme);
        applySettings();
        pushSync();
        toast("Settings imported", "", "ok");
        loadAllMedia();
      } catch {
        toast("Import failed", "That file doesn't look like a Vaultmall backup.", "err");
      }
    };
    reader.readAsText(file);
  });

  $("#clear-cache-btn").addEventListener("click", () => {
    if (!confirm("Clear this device's cached data? Your account copy stays safe and comes back on reload.")) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith("vaultmall:"))
      .forEach((k) => localStorage.removeItem(k));
    location.reload();
  });

  // Metadata engine form
  $("#meta-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.meta = { tmdb: $("#tmdb-key").value.trim(), omdb: $("#omdb-key").value.trim() };
    omdbComplained = false; // a fresh key deserves a fresh complaint, if it earns one
    saveMeta(state.user.uid, state.meta);
    pushSync();
    toast("Metadata keys saved", state.meta.tmdb ? "Films will now identify themselves." : "TMDb key removed.", "ok");
  });

  // Match modal search
  $("#match-form").addEventListener("submit", (e) => { e.preventDefault(); runMatchSearch(); });
}

function wireUserMenu() {
  const chip = $(".userchip");
  const btn = $("#user-menu-btn");
  const menu = $("#user-menu");
  const sync = () => chip.classList.toggle("open", !menu.classList.contains("hidden"));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
    sync();
  });
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("hidden") && !menu.contains(e.target)) { menu.classList.add("hidden"); sync(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { menu.classList.add("hidden"); sync(); } });
  menu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-menu]");
    if (!item) return;
    menu.classList.add("hidden");
    sync();
    if (item.dataset.menu === "settings") setEnv("settings");
    else if (item.dataset.menu === "help") setEnv("help");
    else if (item.dataset.menu === "photo") $("#avatar-input").click();
    else if (item.dataset.menu === "signout") FB && FB.logOut();
  });
}

function setEnv(env) {
  state.env = env;
  document.body.dataset.env = env;

  // section visibility: all cinema-flavoured envs share one section
  const section = CINEMA_ENVS.includes(env) ? "cinema" : env;
  ["cinema", "photos", "sources", "settings", "help"].forEach((e) => {
    const sec = $(`#env-${e}`);
    if (e === section) { sec.classList.remove("hidden"); sec.style.animation = "none"; void sec.offsetWidth; sec.style.animation = ""; }
    else sec.classList.add("hidden");
  });

  // category picker mirrors the env when it maps to one
  const cat = env === "tv" ? "tv" : env === "photos" ? "photos" : env === "sources" ? "sources" : "movies";
  $("#cat-label").textContent = CAT_LABELS[cat];
  $$("#cat-menu button").forEach((b) => b.classList.toggle("is-active", b.dataset.cat === cat));

  // sidebar active state: movies+tv are both "Home"
  const nav = env === "tv" || env === "photos" || env === "sources" ? "movies" : env;
  $$(".snav-item").forEach((b) => b.classList.toggle("is-active", b.dataset.nav === nav && CINEMA_ENVS.concat("settings", "help").includes(env)));

  exitSelectMode();
  requestAnimationFrame(repositionSwitches);
  refreshEnv();
}

function wireCatPicker() {
  const cat = $("#catpick");
  const btn = $("#cat-btn");
  const menu = $("#cat-menu");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
    cat.classList.toggle("open", !menu.classList.contains("hidden"));
  });
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("hidden") && !cat.contains(e.target)) {
      menu.classList.add("hidden");
      cat.classList.remove("open");
    }
  });
  menu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-cat]");
    if (!item) return;
    menu.classList.add("hidden");
    cat.classList.remove("open");
    setEnv(item.dataset.cat);
  });
}

// ============================================================
//  Notifications — errors and events, collected under the bell
// ============================================================
const notifKey = (uid) => `vaultmall:notifs:${uid}`;
function loadNotifs() {
  try { state.notifs = JSON.parse(localStorage.getItem(notifKey(state.user.uid))) || []; }
  catch { state.notifs = []; }
  renderNotifDot();
}
function saveNotifs() {
  if (state.user) localStorage.setItem(notifKey(state.user.uid), JSON.stringify(state.notifs.slice(0, 50)));
}
function notify(title, msg, kind) {
  state.notifs.unshift({ title, msg: msg || "", kind: kind || "", at: Date.now(), read: false });
  state.notifs = state.notifs.slice(0, 50);
  saveNotifs();
  renderNotifDot();
  const btn = $("#notif-btn");
  if (btn && kind === "err") {
    btn.classList.remove("ringing"); void btn.offsetWidth; btn.classList.add("ringing");
  }
  if (!$("#notif-panel").classList.contains("hidden")) renderNotifList();
}
function renderNotifDot() {
  const unread = state.notifs.some((n) => !n.read);
  $("#notif-dot").classList.toggle("hidden", !unread);
}
function timeAgo(t) {
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}S`;
  if (s < 3600) return `${Math.floor(s / 60)}M`;
  if (s < 86400) return `${Math.floor(s / 3600)}H`;
  return `${Math.floor(s / 86400)}D`;
}
function renderNotifList() {
  const box = $("#notif-list");
  box.innerHTML = "";
  if (!state.notifs.length) {
    box.appendChild(el("div", "notif-empty", "All quiet. Errors and events will land here."));
    return;
  }
  state.notifs.forEach((n) => {
    box.appendChild(el("div", `notif-item ${n.kind}`, `
      <span class="notif-kind"></span>
      <span class="notif-body"><b>${escapeHtml(n.title)}</b>${n.msg ? `<span>${escapeHtml(n.msg)}</span>` : ""}</span>
      <span class="notif-time">${timeAgo(n.at)}</span>`));
  });
}
function wireNotifs() {
  const btn = $("#notif-btn");
  const panel = $("#notif-panel");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden");
    if (opening) {
      renderNotifList();
      state.notifs.forEach((n) => { n.read = true; });
      saveNotifs();
      renderNotifDot();
    }
  });
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("hidden") && !panel.contains(e.target) && e.target !== btn) panel.classList.add("hidden");
  });
  $("#notif-clear").addEventListener("click", () => {
    state.notifs = [];
    saveNotifs();
    renderNotifDot();
    renderNotifList();
  });
}

function wireSwitch(root, onChange) {
  if (!root) return;
  const ink = $(".sw-ink", root);
  const position = () => {
    const a = $(".sw-opt.is-active", root);
    if (a && ink && a.offsetWidth) {
      ink.style.width = a.offsetWidth + "px";
      ink.style.transform = `translateX(${a.offsetLeft}px)`;
    }
  };
  root._position = position; // re-measured whenever the env becomes visible
  $$(".sw-opt", root).forEach((b) =>
    b.addEventListener("click", () => {
      $$(".sw-opt", root).forEach((x) => x.classList.toggle("is-active", x === b));
      position();
      onChange(b.dataset.mode || b.dataset.type);
    })
  );
  requestAnimationFrame(position);
  window.addEventListener("resize", position);
}

function repositionSwitches() {
  $$(".switch").forEach((s) => s._position && s._position());
}

function refreshEnv() {
  if (state.env === "photos") renderPhotos();
  else if (CINEMA_ENVS.includes(state.env)) renderCinema();
  else if (state.env === "settings") renderSettings();
  else if (state.env === "help") { /* static page */ }
  else renderSources();
  renderContinue();
}

function renderSettings() {
  applySettings();
  $("#settings-username").textContent = state.profile.username || "user";
}

// ============================================================
//  Media loading (unchanged plumbing)
// ============================================================
async function loadAllMedia() {
  const ids = Object.keys(state.profile.connections || {}).filter((id) => getProvider(id));
  const toLoad = [];
  for (const id of ids) {
    const p = getProvider(id);
    if (p.kind === "cloud") { toLoad.push(id); continue; }
    if (id === "local" && (await p.module.permissionGranted(state.user.uid).catch(() => false))) toLoad.push(id);
    else { state.needsReconnect[id] = true; state.bySource[id] = []; }
  }
  await Promise.allSettled(toLoad.map((id) => loadSource(id, { silent: true })));
  rebuildMedia();
  refreshEnv();
}

async function loadSource(id, { silent } = {}) {
  const p = getProvider(id);
  if (!p || !p.module || typeof p.module.list !== "function") return;
  const config = (state.profile.connections || {})[id] || {};
  try {
    let items;
    if (id === "local") items = await p.module.list(state.user.uid, { onProgress: () => {} });
    else items = await p.module.list(config);
    state.bySource[id] = items || [];
    delete state.needsReconnect[id];
  } catch (e) {
    state.bySource[id] = [];
    if (!silent) toast(`${p.name} couldn't load`, e.message, "err");
  }
  rebuildMedia();
  if (!silent) refreshEnv();
}

function rebuildMedia() {
  state.media = Object.values(state.bySource).flat();
}

async function reconnect(id) {
  await loadSource(id);
  refreshEnv();
}

// ---- Photos/Films split ----
function isFilmItem(item) {
  const fs = state.films.store;
  if (fs.exclude.includes(item.id)) return false;
  if (fs.include.includes(item.id)) return true;
  return F.looksLikeFilm(item);
}
const photoItems = () => state.media.filter((m) => !isFilmItem(m));
const filmItems = () => state.media.filter((m) => isFilmItem(m));

// ============================================================
//  PHOTOS
// ============================================================
function renderPhotos() {
  const feed = $("#photos-feed");
  const strip = $("#albums-strip");
  feed.innerHTML = "";
  strip.innerHTML = "";

  let items = photoItems();
  if (state.photos.type !== "all") items = items.filter((m) => m.type === state.photos.type);
  if (state.search) items = items.filter((m) => m.title.toLowerCase().includes(state.search));

  $("#photos-count").textContent = `${items.length} ITEM${items.length === 1 ? "" : "S"}`;

  const hasSources = Object.keys(state.profile.connections || {}).length > 0;
  const reconnectIds = Object.keys(state.needsReconnect);

  if (!hasSources && items.length === 0) {
    hide("#albums-strip"); show("#photos-empty");
    return;
  }
  hide("#photos-empty");

  const phSw = $("#ph-mode");
  if (phSw) {
    $$(".sw-opt", phSw).forEach((o) => o.classList.toggle("is-active", o.dataset.mode === state.photos.mode));
    if (phSw._position) requestAnimationFrame(phSw._position);
  }

  if (state.photos.mode === "albums") {
    strip.classList.remove("hidden");
    renderAlbumsStrip(strip);
    const album = state.albums.find((a) => a.id === state.photos.albumId);
    if (!album) {
      feed.appendChild(el("div", "bigempty",
        `<div class="bigempty-word">ALBUMS</div><p>${state.albums.length ? "Pick an album above, or select photos in the Timeline to fill one." : "Create your first album, then use Select in the Timeline to fill it."}</p>`));
      state._visible = [];
      return;
    }
    items = album.itemIds.map((id) => items.find((m) => m.id === id)).filter(Boolean);
    renderAlbumTools(feed, album);
  } else {
    strip.classList.add("hidden");
  }

  // Reconnect notices for device/OAuth sources
  if (reconnectIds.length) {
    const bar = el("div", "ph-toolbar");
    reconnectIds.forEach((id) => {
      const p = getProvider(id);
      if (!p) return;
      const b = el("button", "btn btn-ghost", `${glyphSvg(id, 13)}&nbsp; Reconnect ${p.name}`);
      b.addEventListener("click", () => reconnect(id));
      bar.appendChild(b);
    });
    feed.appendChild(bar);
  }

  state._visible = [];

  if (state.photos.mode === "timeline") {
    const groups = groupByMonth(items);
    for (const g of groups) {
      const sec = el("section", "tl-group");
      sec.appendChild(el("div", "tl-head",
        `<span class="tl-title">${g.label}</span><span class="tl-rule"></span><span class="tl-count mono">${g.items.length}</span>`));
      sec.appendChild(buildMasonry(g.items));
      feed.appendChild(sec);
    }
    if (!groups.length && hasSources) {
      feed.appendChild(el("div", "bigempty", `<div class="bigempty-word">QUIET</div><p>No media matches this view.</p>`));
    }
  } else if (items.length) {
    feed.appendChild(buildMasonry(items));
  }
}

function groupByMonth(items) {
  const map = new Map();
  const sorted = [...items].sort((a, b) => (b.date || 0) - (a.date || 0));
  for (const m of sorted) {
    const label = m.date
      ? new Date(m.date).toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : "Undated";
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(m);
  }
  return [...map.entries()].map(([label, items]) => ({ label, items }));
}

function buildMasonry(items) {
  const wall = el("div", "masonry");
  items.forEach((m, i) => {
    const globalIndex = state._visible.push(m) - 1;
    const t = el("figure", "tile");
    t.style.setProperty("--d", Math.min(i, 14));
    const src = getProvider(m.source);
    const media = m.type === "video"
      ? (m.thumbUrl && !m.external
          ? `<img loading="lazy" src="${m.thumbUrl}" alt="">`
          : m.fullUrl && !m.external
            ? `<video src="${m.fullUrl}" muted preload="metadata"></video>`
            : `<div class="placeholder">▶</div>`)
      : m.thumbUrl
        ? `<img loading="lazy" src="${m.thumbUrl}" alt="${escapeHtml(m.title)}">`
        : `<div class="placeholder">◻</div>`;
    t.innerHTML = `
      ${media}
      ${m.type === "video" ? `<span class="tile-vid">VID</span>` : ""}
      <figcaption class="tile-strip">
        <span class="tile-name">${escapeHtml(m.title)}</span>
        <span class="tile-src" title="${src ? src.name : m.source}">${glyphSvg(m.source, 13)}</span>
      </figcaption>`;
    t.addEventListener("click", () => {
      if (state.photos.selecting) return toggleSelected(t, m);
      openLightbox(globalIndex);
    });
    if (state.photos.selecting) t.classList.add("selectable");
    if (state.photos.selected.has(m.id)) t.classList.add("selected");
    wall.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add("in")));
  });
  return wall;
}

// ---- albums ----
function renderAlbumsStrip(strip) {
  state.albums.forEach((a) => {
    const c = el("button", "albumcard" + (state.photos.albumId === a.id ? " is-active" : ""),
      `<span class="alb-name">${escapeHtml(a.name)}</span><span class="alb-count">${a.itemIds.length} ITEMS</span>`);
    c.addEventListener("click", () => { state.photos.albumId = a.id; renderPhotos(); });
    strip.appendChild(c);
  });
  const add = el("button", "albumcard newbtn", "+ New album");
  add.addEventListener("click", () => {
    const name = prompt("Album name");
    if (!name) return;
    albums.createAlbum(state.user.uid, name);
    state.albums = albums.loadAlbums(state.user.uid);
    pushSync();
    renderPhotos();
  });
  strip.appendChild(add);
}

function renderAlbumTools(feed, album) {
  const bar = el("div", "ph-toolbar");
  const rename = el("button", "btn btn-ghost", "Rename");
  rename.addEventListener("click", () => {
    const name = prompt("Rename album", album.name);
    if (!name) return;
    albums.renameAlbum(state.user.uid, album.id, name);
    state.albums = albums.loadAlbums(state.user.uid);
    pushSync();
    renderPhotos();
  });
  const del = el("button", "btn btn-danger", "Delete album");
  del.addEventListener("click", () => {
    if (!confirm(`Delete “${album.name}”? Media itself is untouched.`)) return;
    albums.deleteAlbum(state.user.uid, album.id);
    state.albums = albums.loadAlbums(state.user.uid);
    pushSync();
    state.photos.albumId = null;
    renderPhotos();
  });
  bar.append(rename, del);
  feed.appendChild(bar);
}

// ---- selection ----
function toggleSelectMode() {
  state.photos.selecting = !state.photos.selecting;
  state.photos.selected.clear();
  $("#ph-select-btn").textContent = state.photos.selecting ? "Done" : "Select";
  if (state.photos.selecting) { show("#selectbar"); updateSelectbar(); }
  else hide("#selectbar");
  renderPhotos();
}
function exitSelectMode() {
  if (!state.photos.selecting) return;
  state.photos.selecting = false;
  state.photos.selected.clear();
  $("#ph-select-btn").textContent = "Select";
  hide("#selectbar");
  hide("#album-picker");
  renderPhotos();
}
function toggleSelected(tile, m) {
  if (state.photos.selected.has(m.id)) { state.photos.selected.delete(m.id); tile.classList.remove("selected"); }
  else { state.photos.selected.add(m.id); tile.classList.add("selected"); }
  updateSelectbar();
}
function updateSelectbar() {
  $("#selectbar-count").textContent = `${state.photos.selected.size} SELECTED`;
}
function openAlbumPicker() {
  const picker = $("#album-picker");
  if (!picker.classList.contains("hidden")) return hide("#album-picker");
  picker.innerHTML = "";
  state.albums.forEach((a) => {
    const b = el("button", null, `${escapeHtml(a.name)} <span class="mono" style="float:right">${a.itemIds.length}</span>`);
    b.addEventListener("click", () => {
      albums.addToAlbum(state.user.uid, a.id, [...state.photos.selected]);
      state.albums = albums.loadAlbums(state.user.uid);
      pushSync();
      toast("Added to album", a.name, "ok");
      exitSelectMode();
    });
    picker.appendChild(b);
  });
  const row = el("div", "newalb");
  const input = el("input");
  input.placeholder = "New album name";
  const go = el("button", null, "Create");
  go.addEventListener("click", () => {
    if (!input.value.trim()) return;
    const a = albums.createAlbum(state.user.uid, input.value);
    albums.addToAlbum(state.user.uid, a.id, [...state.photos.selected]);
    state.albums = albums.loadAlbums(state.user.uid);
    pushSync();
    toast("Album created", a.name, "ok");
    exitSelectMode();
  });
  row.append(input, go);
  picker.appendChild(row);
  show("#album-picker");
}

// ============================================================
//  FILMS
// ============================================================
let heroIndex = 0;
let heroTimer = null;

// Turn raw film-candidate items into library entries: standalone movies,
// and series groups (episodes folded into one title, Jellyfin-style).
function buildLibrary(items) {
  const fs = state.films.store;
  const movies = [];
  const seriesMap = new Map();
  for (const item of items) {
    const c = F.classify(item);
    if (c.kind === "episode") {
      if (!seriesMap.has(c.seriesKey)) {
        seriesMap.set(c.seriesKey, { series: true, key: c.seriesKey, title: c.seriesTitle, year: c.year, episodes: [], date: 0 });
      }
      const g = seriesMap.get(c.seriesKey);
      g.episodes.push({ item, season: c.season, episode: c.episode });
      g.date = Math.max(g.date, item.date || 0);
    } else {
      movies.push({ item, key: item.id, title: c.title || item.title, year: c.year, date: item.date || 0 });
    }
  }
  const entries = [];
  for (const m of movies) entries.push({ ...m, match: fs.matches[m.key] && !fs.matches[m.key].failed ? fs.matches[m.key] : null });
  for (const g of seriesMap.values()) {
    g.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    entries.push({ ...g, match: fs.matches[g.key] && !fs.matches[g.key].failed ? fs.matches[g.key] : null });
  }
  return entries;
}

// ---- favorites (kept in the synced film store) ----
function isFav(key) { return (state.films.store.favs || []).includes(key); }
function toggleFav(key) {
  const fs = state.films.store;
  fs.favs = fs.favs || [];
  const i = fs.favs.indexOf(key);
  if (i >= 0) fs.favs.splice(i, 1);
  else fs.favs.push(key);
  F.saveFilmStore(state.user.uid, fs);
  pushSync();
  return i < 0;
}

function fmtRuntime(min) {
  if (!min) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${m ? m + "min" : ""}`.trim() : `${m}min`;
}

const CIN_TITLES = { favorites: "Favorites", recent: "Recently added", trending: "Trending" };

function renderCinema() {
  const grid = $("#films-grid");
  grid.innerHTML = "";
  const env = state.env;
  const candidates = filmItems();

  // page heading for the sidebar views
  const headed = !!CIN_TITLES[env];
  $("#cin-head").classList.toggle("hidden", !headed);
  if (headed) $("#cin-title").textContent = CIN_TITLES[env];

  if (!candidates.length) {
    hide("#films-hero"); hide("#films-matchbar"); hide("#chips-row");
    $("#films-setup-msg").textContent = Object.keys(state.profile.connections || {}).length
      ? "Nothing film-shaped yet. Name things like Title (2019).mkv or keep shows in Season folders and they will find their own way here."
      : "Connect a source, then add your free TMDb key. Your pile of videos becomes an actual library.";
    show("#films-setup");
    if (headed) $("#cin-count").textContent = "0 TITLES";
    return;
  }
  hide("#films-setup");

  const all = buildLibrary(candidates);

  // a one-line nudge when there's no TMDb key yet
  grid.parentElement.querySelectorAll(".tmdb-note").forEach((n) => n.remove());
  if (!state.meta.tmdb) {
    grid.parentElement.insertBefore(
      el("div", "matchbar tmdb-note",
        `<span class="mono">ADD A FREE TMDB KEY IN SOURCES AND THESE ${all.length} TITLES GET POSTERS, RATINGS AND CAST.</span>`),
      grid);
  } else if (env === "movies" || env === "tv") {
    autoMatch(all);
  }

  // the working set for this view
  let entries;
  if (env === "tv") entries = all.filter((e) => e.series);
  else if (env === "movies") entries = all.filter((e) => !e.series);
  else if (env === "favorites") entries = all.filter((e) => isFav(e.key));
  else if (env === "trending") entries = all.filter((e) => e.match).sort((a, b) => b.match.vote - a.match.vote);
  else entries = [...all].sort((a, b) => (b.date || 0) - (a.date || 0)); // recent

  // search filters the set, hides the hero
  if (state.search) {
    entries = entries.filter((e) =>
      ((e.match ? e.match.title : e.title) || "").toLowerCase().includes(state.search) ||
      ((e.title || "")).toLowerCase().includes(state.search));
  }

  // hero: only on the two big shelves, only when not searching
  if ((env === "movies" || env === "tv") && !state.search) {
    renderHero(entries.filter((e) => e.match && e.match.backdrop)
      .sort((a, b) => b.match.vote - a.match.vote).slice(0, 5));
  } else {
    clearInterval(heroTimer);
    hide("#films-hero");
  }

  // genre chips from the working set
  renderChips(entries);
  let shown = entries;
  if (state.genre !== "All") {
    shown = entries.filter((e) => e.match && (e.match.genres || []).includes(state.genre));
  }
  // default ordering on the shelves: newest first, unmatched last
  if (env === "movies" || env === "tv") {
    shown = [...shown].sort((a, b) => (!!b.match - !!a.match) || (b.date || 0) - (a.date || 0));
  }

  if (headed) $("#cin-count").textContent = `${shown.length} TITLE${shown.length === 1 ? "" : "S"}`;

  if (!shown.length) {
    grid.appendChild(el("div", "bigempty", `<div class="bigempty-word">${env === "favorites" ? "EMPTY" : "QUIET"}</div>
      <p>${env === "favorites" ? "Nothing hearted yet. The ♥ lives on the hero and on every title page." : "Nothing matches this view."}</p>`));
    return;
  }

  shown.forEach((e, i) => {
    const card = buildPoster(e, i);
    grid.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("in")));
  });
}

function renderChips(entries) {
  const row = $("#chips-row");
  const box = $("#chips");
  const genres = new Map();
  for (const e of entries) {
    if (!e.match) continue;
    for (const g of e.match.genres || []) genres.set(g, (genres.get(g) || 0) + 1);
  }
  const names = [...genres.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  if (!names.length) { row.classList.add("hidden"); state.genre = "All"; return; }
  row.classList.remove("hidden");
  if (state.genre !== "All" && !names.includes(state.genre)) state.genre = "All";
  box.innerHTML = "";
  ["All", ...names].forEach((g) => {
    const chip = el("button", "chip" + (state.genre === g ? " is-active" : ""), escapeHtml(g));
    chip.addEventListener("click", () => {
      state.genre = g;
      $$(".chip", box).forEach((c) => c.classList.toggle("is-active", c === chip));
      renderCinema();
    });
    box.appendChild(chip);
  });
}

function buildPoster(entry, i) {
  const { match } = entry;
  const c = el("article", "pcard");
  c.style.setProperty("--d", Math.min(i, 16));
  const title = match ? match.title : (entry.title || (entry.item ? entry.item.title : "?"));
  const year = match ? match.year : (entry.year || "");
  const art = match && match.poster
    ? `<img loading="lazy" src="${F.posterUrl(match.poster)}" alt="">`
    : `<div class="pcard-fallback"><span class="pf-big">${escapeHtml((title || "?").slice(0, 1).toUpperCase())}</span><span class="pf-title">${escapeHtml(title)}</span></div>`;
  const sub = match
    ? `${year || "·"} · <span class="star">★</span><span class="stat">${match.vote.toFixed(1)}</span>`
    : entry.series
      ? `${entry.episodes.length} episodes`
      : `${year || "unidentified"}`;
  c.innerHTML = `
    <div class="pcard-art">
      ${!match ? `<span class="pcard-flag">FIX MATCH</span>` : ""}
      ${entry.series && match ? `<span class="pcard-flag series">SERIES · ${entry.episodes.length} EP</span>` : ""}
      ${art}
      <div class="pcard-hover"><span><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.9c0-1.2 1.3-1.9 2.3-1.3l9.2 6.1c.9.6.9 1.9 0 2.5l-9.2 6.1c-1 .7-2.3-.1-2.3-1.3z"/></svg></span></div>
    </div>
    <div class="pcard-name">${escapeHtml(title)}</div>
    <div class="pcard-sub">${sub}</div>`;
  c.addEventListener("click", () => (match ? openFilmDetail(entry, match) : openMatchModal(entry)));
  return c;
}

// ---- hero: the marquee deck with peeking next cards ----
let heroEntries = [];
function renderHero(entries) {
  const hero = $("#films-hero");
  const stack = $("#hero-stack");
  const dots = $("#hero-dots");
  clearInterval(heroTimer);
  heroEntries = entries;
  if (!entries.length) { hero.classList.add("hidden"); return; }
  hero.classList.remove("hidden");

  stack.innerHTML = "";
  dots.innerHTML = "";
  entries.forEach((entry, i) => {
    const { match } = entry;
    const card = el("article", "hs-card");
    const tags = [];
    if (match.runtime) tags.push(fmtRuntime(match.runtime));
    if ((match.genres || [])[0]) tags.push(match.genres[0]);
    tags.push(entry.series ? "Series" : "Movie");
    if (match.year) tags.push(match.year);
    card.innerHTML = `
      <img class="hs-art" src="${F.backdropUrl(match.backdrop)}" alt="">
      <div class="hs-scrim"></div>
      <div class="hs-tags">
        ${tags.map((t, ti) => `<span class="hs-tag" style="--d:${ti}">${escapeHtml(String(t))}</span>`).join("")}
        <span class="hs-tag star" style="--d:${tags.length}">★ ${match.vote.toFixed(1)}</span>
      </div>
      <div class="hs-bottom">
        <button class="hs-play" aria-label="Play">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.9c0-1.2 1.3-1.9 2.3-1.3l9.2 6.1c.9.6.9 1.9 0 2.5l-9.2 6.1c-1 .7-2.3-.1-2.3-1.3z"/></svg>
        </button>
        <div class="hs-titlebox">
          <b>${escapeHtml(match.title)}</b>
          <span>${entry.series ? `${entry.episodes.length} episodes` : "Play now"}${match.year ? ` · ${match.year}` : ""}</span>
        </div>
      </div>
      <button class="hs-fav${isFav(entry.key) ? " faved" : ""}" aria-label="Favorite">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="${isFav(entry.key) ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 20.5s-7.2-4.4-9.3-8.6C1.2 8.7 3 5.3 6.4 5.3c2 0 3.6 1.1 4.6 2.6h2c1-1.5 2.6-2.6 4.6-2.6 3.4 0 5.2 3.4 3.7 6.6-2.1 4.2-9.3 8.6-9.3 8.6z"/></svg>
      </button>`;
    $(".hs-play", card).addEventListener("click", (e) => {
      e.stopPropagation();
      playFilm(entry.series ? entry.episodes[0].item : entry.item);
    });
    $(".hs-titlebox", card).addEventListener("click", () => openFilmDetail(entry, match));
    $(".hs-fav", card).addEventListener("click", (e) => {
      e.stopPropagation();
      const on = toggleFav(entry.key);
      const b = e.currentTarget;
      b.classList.toggle("faved", on);
      $("svg", b).setAttribute("fill", on ? "currentColor" : "none");
      if (state.env === "favorites") renderCinema();
    });
    card.addEventListener("click", () => {
      // clicking a peeking card brings it forward
      if (!card.classList.contains("pos-0")) goHero(i);
    });
    stack.appendChild(card);

    const dot = el("button", "hero-dot" + (i === 0 ? " is-active" : ""));
    dot.setAttribute("aria-label", `Slide ${i + 1}`);
    dot.addEventListener("click", () => goHero(i));
    dots.appendChild(dot);
  });

  // pause the carousel while the pointer is on it
  stack.addEventListener("mouseenter", () => clearInterval(heroTimer));
  stack.addEventListener("mouseleave", () => {
    clearInterval(heroTimer);
    heroTimer = setInterval(() => stepHero(1), 8000);
  });

  heroIndex = 0;
  layoutHero();
  heroTimer = setInterval(() => stepHero(1), 8000);
}
function layoutHero() {
  const stack = $("#hero-stack");
  const n = heroEntries.length;
  $$(".hs-card", stack).forEach((c, i) => {
    const rel = ((i - heroIndex) % n + n) % n;
    c.classList.remove("pos-0", "pos-1", "pos-2", "pos-3");
    c.classList.add("pos-" + Math.min(rel, 3));
  });
  $$("#hero-dots .hero-dot").forEach((d, di) => d.classList.toggle("is-active", di === heroIndex));
}
function goHero(i) {
  const n = heroEntries.length;
  if (!n) return;
  heroIndex = ((i % n) + n) % n;
  layoutHero();
}
function stepHero(dir) { goHero(heroIndex + dir); }

// ============================================================
//  Continue watching — resume points in the sidebar
// ============================================================
const progressKey = (uid) => `vaultmall:progress:${uid}`;
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(progressKey(state.user.uid))) || {}; }
  catch { return {}; }
}
function saveProgressStore(all) {
  localStorage.setItem(progressKey(state.user.uid), JSON.stringify(all));
}

// Watch a <video> element and remember where the viewer got to.
// Clips under 3 minutes don't need resume points.
function attachProgress(video, m) {
  if (!state.user || !m || !m.id) return;
  const saved = loadProgress()[m.id];
  if (saved && saved.t > 30 && saved.pct < 95) {
    const resume = () => {
      if (video.duration && isFinite(video.duration) && saved.t < video.duration - 15) video.currentTime = saved.t;
    };
    if (video.readyState >= 1) resume(); // metadata already in (Vaultmux path)
    else video.addEventListener("loadedmetadata", resume, { once: true });
  }
  let last = 0;
  video.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - last < 5000) return;
    last = now;
    const d = video.duration;
    if (!d || !isFinite(d) || d < 180) return;
    const all = loadProgress();
    const pct = Math.round((video.currentTime / d) * 100);
    if (pct >= 96) delete all[m.id];
    else all[m.id] = { id: m.id, title: m.title, t: Math.floor(video.currentTime), d: Math.floor(d), pct, at: now };
    saveProgressStore(all);
    renderContinue();
  });
}

function renderContinue() {
  const block = $("#continue-block");
  const box = $("#continue-list");
  if (!block || !state.user) return;
  const rows = Object.values(loadProgress()).sort((a, b) => b.at - a.at).slice(0, 4);
  block.classList.toggle("hidden", !rows.length);
  box.innerHTML = "";
  if (!rows.length) return;

  // borrow titles and backdrops from the matched library
  const byItem = new Map();
  for (const e of buildLibrary(filmItems())) {
    if (e.series) e.episodes.forEach((ep) => byItem.set(ep.item.id, { e, ep }));
    else byItem.set(e.item.id, { e });
  }

  rows.forEach((p, i) => {
    const hit = byItem.get(p.id);
    const match = hit && hit.e.match;
    const title = match ? match.title : p.title;
    const sub = hit && hit.ep ? `S${hit.ep.season}.E${hit.ep.episode}` : fmtRuntime(Math.round((p.d - p.t) / 60)) + " left";
    const art = match && match.backdrop ? `<img loading="lazy" src="${F.backdropUrl(match.backdrop, "w780")}" alt="">`
      : `<span class="ccard-noart">${escapeHtml((title || "?").slice(0, 1).toUpperCase())}</span>`;
    const card = el("button", "ccard", `
      ${art}
      <span class="ccard-scrim"></span>
      <span class="ccard-title">${escapeHtml(title)}</span>
      <span class="ccard-row">
        <span class="ccard-play">▶</span>
        <span class="ccard-pill">${escapeHtml(sub)}</span>
        <span class="ccard-pill pct">${p.pct}%</span>
      </span>
      <span class="ccard-bar"><i style="width:${p.pct}%"></i></span>`);
    card.style.setProperty("--d", i);
    card.addEventListener("click", () => {
      const item = state.media.find((x) => x.id === p.id);
      if (item) playFilm(item);
      else toast("Can't resume", "That file's source isn't loaded right now.", "err");
    });
    box.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("in")));
  });
}

// ---- auto matching ----
async function autoMatch(entries) {
  if (state.films.matching || !state.meta.tmdb) return;
  const fs = state.films.store;
  const todo = entries.filter((e) => !fs.matches[e.key]);
  if (!todo.length) { hide("#films-matchbar"); return; }

  state.films.matching = true;
  show("#films-matchbar");
  let done = 0;
  for (const entry of todo) {
    $("#matchbar-label").textContent = `IDENTIFYING ${done + 1}/${todo.length} · ${(entry.title || "").slice(0, 40)}`;
    $("#matchbar-fill").style.width = `${Math.round((done / todo.length) * 100)}%`;
    try {
      let hits = entry.title ? await F.searchTitles(state.meta.tmdb, entry.title, entry.year) : [];
      // Series must land on a TV result; movies prefer film results.
      if (entry.series) hits = hits.filter((h) => h.kind === "tv").concat(hits.filter((h) => h.kind !== "tv"));
      if (hits.length) {
        const detail = await F.titleDetails(state.meta.tmdb, hits[0].kind, hits[0].tmdbId);
        const scores = await F.omdbScores(state.meta.omdb, detail.imdbId)
          .catch((err) => { omdbComplain(err); return {}; });
        fs.matches[entry.key] = { ...detail, ...scores };
      } else {
        fs.matches[entry.key] = { failed: true };
      }
    } catch (e) {
      toast("TMDb", e.message, "err");
      break;
    }
    done++;
    F.saveFilmStore(state.user.uid, fs);
    pushSync();
  }
  $("#matchbar-fill").style.width = "100%";
  state.films.matching = false;
  setTimeout(() => { hide("#films-matchbar"); if (CINEMA_ENVS.includes(state.env)) renderCinema(); renderContinue(); }, 400);
}

// A broken OMDb key fails on every title; complain once, not per film.
let omdbComplained = false;
function omdbComplain(e) {
  if (omdbComplained || !/OMDb/.test(e.message || "")) return;
  omdbComplained = true;
  toast("OMDb", e.message, "err");
}

// ---- film / series title page ----
function openFilmDetail(entry, match) {
  renderFilmSheet(entry, match);
  show("#film-modal");
  $("#filmsheet").scrollTop = 0;
  enrichMatch(entry, match); // older matches lack logo/cast photos; fetch once
}

// Matches saved before logos/cast photos existed get upgraded in place.
// Same for scores: an OMDb key added after a title was matched still
// gets its IMDb/RT numbers pulled the next time the page opens.
async function enrichMatch(entry, match) {
  if (!state.meta.tmdb || !match.tmdbId) return;
  const needsDetail = !match.rich;
  const needsScores = !!state.meta.omdb && !match.imdb && !match.rt;
  if (!needsDetail && !needsScores) return;
  try {
    const detail = needsDetail
      ? await F.titleDetails(state.meta.tmdb, match.kind || "movie", match.tmdbId)
      : {};
    const scores = await F.omdbScores(state.meta.omdb, detail.imdbId || match.imdbId)
      .catch((e) => { omdbComplain(e); return {}; });
    Object.assign(match, detail, scores);
    state.films.store.matches[entry.key] = match;
    F.saveFilmStore(state.user.uid, state.films.store);
    pushSync();
    if (!$("#film-modal").classList.contains("hidden")) renderFilmSheet(entry, match);
  } catch { /* page still works with what we have */ }
}

function renderFilmSheet(entry, match) {
  const item = entry.series ? entry.episodes[0].item : entry.item;
  const sheet = $("#filmsheet");
  const scores = [
    { cls: "tmdb", label: "TMDB", value: match.vote ? match.vote.toFixed(1) : "n/a" },
    { cls: "imdb", label: "IMDB", value: match.imdb || "n/a" },
    { cls: "rt", label: "TOMATOES", value: match.rt || "n/a" },
  ];
  const cast = (match.cast || []).map((c) => (typeof c === "string" ? { name: c, role: "", img: "" } : c));

  sheet.innerHTML = `
    <div class="fs-backdrop${match.backdrop ? "" : " no-art"}">
      ${match.backdrop ? `<img src="${F.backdropUrl(match.backdrop, "original")}" alt="">` : ""}
      <button class="fs-back" data-x>← BACK</button>
    </div>
    <div class="fs-body">
      <div class="fs-hero">
        <div class="fs-left">
          ${match.logo
            ? `<div class="fs-logo"><img src="${F.logoUrl(match.logo)}" alt="${escapeHtml(match.title)}"></div>`
            : `<h3 class="fs-title">${escapeHtml(match.title)}</h3>`}
          <div class="fs-playrow"></div>
          <div class="fs-actionrow"></div>
        </div>
        <div class="fs-right">
          <div class="fs-meta">
            <span>${match.year || ""}</span>
            ${match.runtime ? `<span class="sep"></span><span>${match.runtime} min</span>` : ""}
            ${(match.genres || []).length ? `<span class="sep"></span><span>${match.genres.join(" / ")}</span>` : ""}
            <span class="sep"></span><span>${match.kind === "tv" ? "SERIES" : "FILM"}</span>
          </div>
          <p class="fs-overview">${escapeHtml(match.overview)}</p>
          <div class="scores">
            ${scores.map((sc) => `<div class="score ${sc.cls}"><b>${escapeHtml(String(sc.value))}</b><span class="mono">${sc.label}</span></div>`).join("")}
          </div>
        </div>
      </div>
      ${cast.length ? `<div class="fs-cast-head mono">CAST</div><div class="fs-castrow">${cast.map((c) => `
        <span class="castcard">
          ${c.img
            ? `<img class="cast-img" loading="lazy" src="${F.profileUrl(c.img)}" alt="">`
            : `<span class="cast-img cast-noimg">${escapeHtml((c.name || "?").slice(0, 1))}</span>`}
          <span class="cast-name">${escapeHtml(c.name)}</span>
          ${c.role ? `<span class="cast-role">${escapeHtml(c.role)}</span>` : ""}
        </span>`).join("")}</div>` : ""}
      ${entry.series ? `<div class="fs-episodes"></div>` : ""}
      <div class="fs-file">${entry.series
        ? `${entry.episodes.length} FILES · ${escapeHtml((getProvider(item.source) || {}).name || item.source)}`
        : `SOURCE FILE · ${escapeHtml(item.title)} · ${escapeHtml((getProvider(item.source) || {}).name || item.source)}`}</div>
    </div>`;

  // Episode list, grouped by season
  if (entry.series) {
    const box = $(".fs-episodes", sheet);
    const seasons = new Map();
    for (const ep of entry.episodes) {
      if (!seasons.has(ep.season)) seasons.set(ep.season, []);
      seasons.get(ep.season).push(ep);
    }
    [...seasons.keys()].sort((a, b) => a - b).forEach((sn) => {
      box.appendChild(el("div", "fs-season mono", `SEASON ${sn}`));
      seasons.get(sn).forEach((ep) => {
        const row = el("button", "fs-ep", `
          <span class="fs-ep-num mono">E${String(ep.episode).padStart(2, "0")}</span>
          <span class="fs-ep-name">${escapeHtml(ep.item.title)}</span>
          <span class="fs-ep-play">▶</span>`);
        row.addEventListener("click", () => { hide("#film-modal"); playFilm(ep.item); });
        box.appendChild(row);
      });
    });
  }

  // Wide play button, then a quiet row of the useful actions
  const play = el("button", "btn btn-accent btn-play", entry.series ? "▶&nbsp;&nbsp;Play first episode" : "▶&nbsp;&nbsp;Play");
  play.addEventListener("click", () => { hide("#film-modal"); playFilm(item); });
  $(".fs-playrow", sheet).appendChild(play);

  const actions = $(".fs-actionrow", sheet);
  const favLabel = () => (isFav(entry.key) ? "♥&nbsp; Favorited" : "♡&nbsp; Favorite");
  const fav = el("button", "btn btn-ghost-ivory btn-sm", favLabel());
  fav.addEventListener("click", () => {
    toggleFav(entry.key);
    fav.innerHTML = favLabel();
    if (CINEMA_ENVS.includes(state.env)) renderCinema();
  });
  actions.appendChild(fav);
  if (item.fullUrl && !item.external && !item.embed) {
    const dl = el("a", "btn btn-ghost-ivory btn-sm", "↓&nbsp; Download");
    dl.href = item.fullUrl;
    dl.setAttribute("download", item.title);
    actions.appendChild(dl);
  }
  const fix = el("button", "btn btn-ghost-ivory btn-sm", "Fix match");
  fix.addEventListener("click", () => { hide("#film-modal"); openMatchModal(entry); });
  const notFilm = el("button", "btn btn-ghost-ivory btn-sm", entry.series ? "Not a series → Photos" : "Not a film → Photos");
  notFilm.addEventListener("click", () => {
    const ids = entry.series ? entry.episodes.map((e) => e.item.id) : [item.id];
    state.films.store.exclude.push(...ids);
    F.saveFilmStore(state.user.uid, state.films.store);
    pushSync();
    hide("#film-modal");
    toast("Moved to Photos", match.title, "ok");
    refreshEnv();
  });
  actions.append(fix, notFilm);
  $("[data-x]", sheet).addEventListener("click", () => hide("#film-modal"));
}

function playFilm(item) {
  state._visible = [item];
  openLightbox(0, true); // solo: it's a screening, not a slideshow
}

// ---- manual match ----
let matchTarget = null; // a library entry: { key, title, series?, episodes?, item? }
function openMatchModal(entry) {
  matchTarget = entry;
  $("#match-filename").textContent = entry.series
    ? `${entry.title} · ${entry.episodes.length} episodes`
    : (entry.item ? entry.item.title : entry.title);
  $("#match-query").value = entry.title || "";
  $("#match-results").innerHTML = "";
  show("#match-modal");
  if (state.meta.tmdb) runMatchSearch();
  else $("#match-results").innerHTML = `<p class="sheet-sub">Add your TMDb key in Sources first.</p>`;
}

async function runMatchSearch() {
  if (!matchTarget || !state.meta.tmdb) return;
  const box = $("#match-results");
  box.innerHTML = `<p class="sheet-sub">Searching…</p>`;
  const q = $("#match-query").value.trim();
  try {
    let hits;
    if (/^\d+$/.test(q)) {
      // A raw TMDb id — try movie, then tv.
      const tryKind = async (kind) => F.titleDetails(state.meta.tmdb, kind, +q).then((d) => ({ ...d, kind }));
      const d = await tryKind("movie").catch(() => tryKind("tv"));
      hits = [{ tmdbId: d.tmdbId, kind: d.kind, title: d.title, year: d.year, poster: d.poster, vote: d.vote }];
    } else {
      hits = await F.searchTitles(state.meta.tmdb, q);
    }
    box.innerHTML = "";
    if (!hits.length) { box.innerHTML = `<p class="sheet-sub">No results. Try fewer words, or paste a TMDb ID.</p>`; return; }
    hits.slice(0, 8).forEach((h) => {
      const row = el("button", "match-hit", `
        ${h.poster ? `<img src="${F.posterUrl(h.poster, 92)}" alt="">` : `<span class="mh-noart">${escapeHtml(h.title.slice(0, 1))}</span>`}
        <span><span class="mh-title">${escapeHtml(h.title)}</span><br><span class="mh-sub">${h.year || "?"} · ${h.kind === "tv" ? "SERIES" : "FILM"} · ★ ${(h.vote || 0).toFixed(1)}</span></span>
        <span class="mh-go">Link →</span>`);
      row.addEventListener("click", async () => {
        row.querySelector(".mh-go").textContent = "Linking…";
        try {
          const detail = await F.titleDetails(state.meta.tmdb, h.kind, h.tmdbId);
          const scores = await F.omdbScores(state.meta.omdb, detail.imdbId)
            .catch((err) => { omdbComplain(err); return {}; });
          const fs = state.films.store;
          fs.matches[matchTarget.key] = { ...detail, ...scores };
          // Manual link implies: these files ARE this title.
          const ids = matchTarget.series ? matchTarget.episodes.map((e) => e.item.id) : [matchTarget.item.id];
          for (const id of ids) {
            if (!fs.include.includes(id)) fs.include.push(id);
          }
          fs.exclude = fs.exclude.filter((x) => !ids.includes(x));
          F.saveFilmStore(state.user.uid, fs);
          pushSync();
          hide("#match-modal");
          toast("Matched", detail.title, "ok");
          refreshEnv();
        } catch (e) {
          toast("Couldn't link", e.message, "err");
        }
      });
      box.appendChild(row);
    });
  } catch (e) {
    box.innerHTML = `<p class="sheet-sub">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
//  SOURCES
// ============================================================
function renderSources() {
  const strip = $("#library-strip");
  const grid = $("#sources-grid");
  strip.innerHTML = "";
  grid.innerHTML = "";

  // unified library strip
  const counts = providerList()
    .map((p) => ({ p, n: (state.bySource[p.id] || []).length }))
    .filter((x) => x.n > 0);
  const total = counts.reduce((s, x) => s + x.n, 0);
  strip.innerHTML = `
    <div class="lib-top">
      <span class="lib-total">${total}<small>ITEMS IN THE UNIFIED LIBRARY</small></span>
      <span class="mono">${counts.length} ACTIVE SOURCE${counts.length === 1 ? "" : "S"}</span>
    </div>`;
  if (total) {
    const bar = el("div", "lib-bar");
    const legend = el("div", "lib-legend");
    counts.forEach(({ p, n }) => {
      const seg = el("span", "lib-seg");
      seg.style.width = `${(n / total) * 100}%`;
      seg.style.background = (BRAND[p.id] || {}).color || "#888";
      seg.title = `${p.name} · ${n}`;
      bar.appendChild(seg);
      legend.appendChild(el("span", "lib-key",
        `<span class="swatch" style="background:${(BRAND[p.id] || {}).color || "#888"}"></span>${p.name.toUpperCase()} · ${n}`));
    });
    strip.append(bar, legend);
  } else {
    strip.appendChild(el("p", "sheet-sub", "Connect a source below and the library fills up."));
  }

  // source cards
  const connections = state.profile.connections || {};
  providerList().forEach((p, i) => {
    const connected = !!connections[p.id];
    const n = (state.bySource[p.id] || []).length;
    const needs = !!state.needsReconnect[p.id];
    const card = el("article", "srccard" + (p.soon ? " soon" : ""));
    card.style.setProperty("--d", i);
    const status = p.soon
      ? `<span class="srccard-status off">PLANNED</span>`
      : !p.available
        ? `<span class="srccard-status off">NOT IN THIS BROWSER</span>`
        : connected
          ? needs
            ? `<span class="srccard-status warn">● NEEDS RECONNECT</span>`
            : `<span class="srccard-status ok">● CONNECTED</span>`
          : `<span class="srccard-status off">○ AVAILABLE</span>`;
    card.innerHTML = `
      ${p.soon ? `<span class="soon-stamp">SOON</span>` : ""}
      <div class="srccard-top">
        ${logoBlock(p.id, 46)}
        <div><div class="srccard-name">${p.name}</div>${status}</div>
      </div>
      <p class="srccard-desc">${p.desc}${p.beta ? " · beta" : ""}</p>
      <div class="srccard-stats">
        <span class="srcstat"><b>${n}</b><span>ITEMS</span></span>
        <span class="srcstat"><b>${(state.bySource[p.id] || []).filter((m) => m.type === "video").length}</b><span>VIDEOS</span></span>
      </div>
      <div class="srccard-actions"></div>`;
    const actions = $(".srccard-actions", card);
    if (!p.soon && p.available) {
      if (connected) {
        if (needs) {
          const rc = el("button", "act primary", "Reconnect");
          rc.addEventListener("click", () => reconnect(p.id));
          actions.appendChild(rc);
        } else {
          const rl = el("button", "act", "Reload");
          rl.addEventListener("click", () => loadSource(p.id));
          actions.appendChild(rl);
        }
        const mg = el("button", "act", "Manage");
        mg.addEventListener("click", () => openConfig(p.id));
        actions.appendChild(mg);
      } else {
        const cn = el("button", "act primary", "Connect");
        cn.addEventListener("click", () => openConfig(p.id));
        actions.appendChild(cn);
      }
    } else {
      actions.appendChild(el("span", "act", "·"));
    }
    grid.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("in")));
  });

  // meta engine current values
  $("#tmdb-key").value = state.meta.tmdb || "";
  $("#omdb-key").value = state.meta.omdb || "";
}

// ============================================================
//  Provider config sheets (same plumbing, new skin)
// ============================================================
function openConfig(providerId) {
  const p = getProvider(providerId);
  const body = $("#config-body");
  $("#config-title").textContent = p.name;
  body.innerHTML = "";
  const existing = (state.profile.connections || {})[providerId] || {};
  if (providerId === "local") renderLocalConfig(p, body, existing);
  else if (providerId === "gdrive") renderOAuthConfig(p, body, existing);
  else if (providerId === "dropbox" && p.module.oauthReady) renderDropboxConfig(p, body, existing);
  else renderFieldConfig(p, body, existing);
  show("#config-modal");
}

function renderLocalConfig(p, body, existing) {
  const connected = !!existing.folderName;
  body.appendChild(el("div", "config-note",
    `Reads a folder straight off this computer. Nothing gets uploaded anywhere, which is rather the point.`));
  body.appendChild(el("p", "config-hint",
    connected ? `Connected folder: <code>${escapeHtml(existing.folderName)}</code>` : "No folder chosen yet."));
  const actions = el("div", "config-actions");
  const pick = el("button", "btn btn-accent", connected ? "Choose a different folder" : "Choose a folder");
  pick.addEventListener("click", async () => {
    try {
      const folderName = await p.module.pickFolder(state.user.uid);
      store.saveConnection(state.user.uid, "local", { folderName });
      state.profile.connections.local = { folderName };
      pushSync();
      toast("Folder connected", folderName, "ok");
      hide("#config-modal");
      await loadSource("local");
      refreshEnv();
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast("Couldn't connect folder", e.message, "err");
    }
  });
  actions.appendChild(pick);
  if (connected) {
    const rm = el("button", "btn btn-danger", "Disconnect");
    rm.addEventListener("click", async () => { await p.module.forget(state.user.uid); disconnectProvider("local"); });
    actions.appendChild(rm);
  }
  body.appendChild(actions);
}

function renderOAuthConfig(p, body, existing) {
  const connected = !!existing.connected;
  const field = el("label", "field");
  field.innerHTML = `<span class="mono">YOUR GOOGLE OAUTH CLIENT ID *</span>`;
  const input = el("input");
  input.type = "text";
  input.placeholder = "1234-abc.apps.googleusercontent.com";
  input.value = existing.clientId || "";
  field.appendChild(input);
  body.appendChild(field);
  body.appendChild(el("div", "config-note",
    `A read-only look at your Drive photos and videos. Paste your Client ID and let Google run its little consent ceremony. Setup steps are in the README if Google is being Google.`));
  const actions = el("div", "config-actions");
  const btn = el("button", "btn btn-accent", connected ? "Reconnect Google Drive" : "Connect Google Drive");
  btn.addEventListener("click", async () => {
    const clientId = input.value.trim();
    if (!clientId) return toast("Client ID required", "Paste your Google OAuth Client ID first.", "err");
    btn.disabled = true;
    btn.textContent = "Opening Google…";
    try {
      await p.module.connect(clientId);
      const cfg = { connected: true, clientId };
      store.saveConnection(state.user.uid, "gdrive", cfg);
      state.profile.connections.gdrive = cfg;
      pushSync();
      toast("Google Drive connected", "", "ok");
      hide("#config-modal");
      await loadSource("gdrive");
      refreshEnv();
    } catch (e) {
      toast("Google Drive failed", e.message, "err");
      btn.disabled = false;
      btn.textContent = "Connect Google Drive";
    }
  });
  actions.appendChild(btn);
  if (connected) {
    const rm = el("button", "btn btn-danger", "Disconnect");
    rm.addEventListener("click", () => disconnectProvider("gdrive"));
    actions.appendChild(rm);
  }
  body.appendChild(actions);
}

// ---- Dropbox (one click, the Infuse way) ----
function renderDropboxConfig(p, body, existing) {
  const connected = !!(existing.refreshToken || existing.accessToken);
  body.appendChild(el("div", "config-note",
    `One click. Dropbox asks you to approve, you come straight back, your media appears. No apps, no tokens, no ceremony.`));
  const actions = el("div", "config-actions");
  const btn = el("button", "btn btn-accent", connected ? "Reconnect Dropbox" : "Connect Dropbox");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Off to Dropbox…";
    try {
      await p.module.beginAuth(); // full-page redirect; we resume on return
    } catch (e) {
      toast("Dropbox", e.message, "err");
      btn.disabled = false;
      btn.textContent = "Connect Dropbox";
    }
  });
  actions.appendChild(btn);
  if (connected) {
    const rm = el("button", "btn btn-danger", "Disconnect");
    rm.addEventListener("click", () => disconnectProvider("dropbox"));
    actions.appendChild(rm);
  }
  body.appendChild(actions);
}

function renderFieldConfig(p, body, existing) {
  const form = el("form");
  form.style.display = "grid";
  form.style.gap = "16px";
  (p.fields || []).forEach((f) => {
    const wrap = el("label", "field");
    wrap.innerHTML = `<span class="mono">${f.label.toUpperCase()}${f.required ? " *" : ""}</span>`;
    const input = el("input");
    input.type = f.type || "text";
    input.placeholder = f.placeholder || "";
    input.value = existing[f.key] || f.default || "";
    input.dataset.key = f.key;
    if (f.required) input.required = true;
    wrap.appendChild(input);
    form.appendChild(wrap);
  });
  const NOTES = {
    cloudinary: `Shows everything in your Cloudinary account. No tagging homework. Grab the three values from your dashboard and paste them in. Only works on the deployed site, so no panic if it sulks on localhost.`,
    dropbox: `Shows the photos and videos from your Dropbox. Make an app in their App Console, give it the two read permissions, generate a token, paste it here. Dropbox makes you earn it.`,
    mega: `Reads a MEGA shared folder. Paste the link, the one with the key in it. Best for smaller folders unless you enjoy watching progress bars.`,
  };
  if (NOTES[p.id]) form.appendChild(el("div", "config-note", NOTES[p.id]));
  const actions = el("div", "config-actions");
  const save = el("button", "btn btn-accent", "Connect");
  save.type = "submit";
  actions.appendChild(save);
  if (existing && Object.keys(existing).length) {
    const rm = el("button", "btn btn-danger", "Disconnect");
    rm.type = "button";
    rm.addEventListener("click", () => disconnectProvider(p.id));
    actions.appendChild(rm);
  }
  form.appendChild(actions);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const config = {};
    $$("input[data-key]", form).forEach((i) => { if (i.value.trim()) config[i.dataset.key] = i.value.trim(); });
    save.disabled = true;
    save.textContent = "Connecting…";
    try {
      const items = await p.module.list(config);
      store.saveConnection(state.user.uid, p.id, config);
      state.profile.connections[p.id] = config;
      pushSync();
      state.bySource[p.id] = items || [];
      delete state.needsReconnect[p.id];
      rebuildMedia();
      toast(`${p.name} connected`, `${(items || []).length} items`, "ok");
      hide("#config-modal");
      refreshEnv();
    } catch (err) {
      if (err && err.soft) {
        store.saveConnection(state.user.uid, p.id, config);
        state.profile.connections[p.id] = config;
        pushSync();
        state.needsReconnect[p.id] = true;
        toast(`${p.name} saved`, err.message, "");
        hide("#config-modal");
        refreshEnv();
        return;
      }
      toast(`${p.name} error`, err.message, "err");
      save.disabled = false;
      save.textContent = "Connect";
    }
  });
  body.appendChild(form);
}

function disconnectProvider(id) {
  store.removeConnection(state.user.uid, id);
  delete state.profile.connections[id];
  pushSync();
  delete state.bySource[id];
  delete state.needsReconnect[id];
  rebuildMedia();
  hide("#config-modal");
  toast("Disconnected", (getProvider(id) || {}).name || id, "ok");
  refreshEnv();
}

// ============================================================
//  Lightbox
// ============================================================
let lightboxIndex = 0;
let lightboxSolo = false;
let slideTimer = null;
let activeTransmux = null; // in-browser MKV→fMP4 player, when engaged

function killTransmux() {
  if (activeTransmux) {
    try { activeTransmux.destroy(); } catch { /* already gone */ }
    activeTransmux = null;
  }
}

function openLightbox(i, solo = false) {
  lightboxIndex = i;
  lightboxSolo = solo;
  renderLightbox();
  show("#lightbox");
}
function closeLightbox() {
  stopSlideshow();
  killTransmux();
  lightboxSolo = false;
  hide("#lightbox");
  $("#lightbox-stage").innerHTML = "";
}

function startSlideshow() {
  const secs = getSettings().slideshow || 5;
  slideTimer = setInterval(() => stepLightbox(1), secs * 1000);
  $("#lb-slideshow").classList.add("active");
  $("#lb-slideshow").textContent = "❚❚";
}
function stopSlideshow() {
  clearInterval(slideTimer);
  slideTimer = null;
  const b = $("#lb-slideshow");
  if (b) { b.classList.remove("active"); b.textContent = "▶"; }
}
function toggleSlideshow() {
  if (slideTimer) stopSlideshow();
  else startSlideshow();
}
function stepLightbox(dir) {
  const items = state._visible || [];
  if (!items.length) return;
  lightboxIndex = (lightboxIndex + dir + items.length) % items.length;
  renderLightbox();
}
async function renderLightbox() {
  killTransmux(); // navigating away from a remuxed stream tears it down
  const items = state._visible || [];
  const m = items[lightboxIndex];
  if (!m) return;
  const stage = $("#lightbox-stage");
  $("#lightbox-caption").textContent = `${m.title} · ${(getProvider(m.source) || {}).name || m.source}`;

  // A single film gets a clean screening room: no arrows, no slideshow.
  const solo = lightboxSolo || items.length < 2;
  $$(".lb-nav").forEach((n) => n.classList.toggle("hidden", solo));
  $("#lb-slideshow").classList.toggle("hidden", solo);

  if (!m.fullUrl && typeof m.resolveFull === "function") {
    stage.innerHTML = `<div class="lb-loading">DECRYPTING…</div>`;
    const openedFor = lightboxIndex;
    try {
      const url = await m.resolveFull();
      m.fullUrl = url;
      if (m.type === "image") m.thumbUrl = m.thumbUrl || url;
      if (lightboxIndex !== openedFor) return;
    } catch {
      stage.innerHTML = `<div class="lb-loading">COULDN'T LOAD THIS FILE.</div>`;
      return;
    }
  }

  // download target follows the current item
  const dl = $("#lb-download");
  if (dl) {
    if (m.fullUrl && !m.external && !m.embed) { dl.href = m.fullUrl; dl.setAttribute("download", m.title); dl.style.display = ""; }
    else dl.style.display = "none";
  }

  const st = getSettings();
  if (m.source === "dropbox" && m.type === "video" && m.path) {
    playDropboxVideo(stage, m);
    return;
  }
  if (m.embed) {
    // Google Drive videos stream through Drive's own embedded player.
    stage.innerHTML = `<iframe src="${m.embed}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
  } else if (m.external) {
    stage.innerHTML = `<a class="btn btn-accent" href="${m.fullUrl}" target="_blank" rel="noopener">Open in ${(getProvider(m.source) || {}).name || "source"} →</a>`;
  } else if (m.type === "video") {
    stage.innerHTML = `<video src="${m.fullUrl}" controls ${st.autoplay ? "autoplay" : ""} ${st.loop ? "loop" : ""}></video>`;
    attachProgress($("video", stage), m);
  } else {
    stage.innerHTML = `<img src="${m.fullUrl}" alt="${escapeHtml(m.title)}">`;
  }
}

// Dropbox video playback, in order of preference:
//   .mkv        -> Vaultmux (our streaming remuxer) on every browser
//   mp4/mov/etc -> the native player
//   otherwise   -> hand-off to Dropbox's transcoding player
async function playDropboxVideo(stage, m) {
  const st = getSettings();
  const openedFor = lightboxIndex;

  if (/\.(mkv)$/i.test(m.title) && m.path) {
    const ok = await playViaVaultmux(stage, m, openedFor);
    if (ok || lightboxIndex !== openedFor) return;
    return dropboxHandoff(stage, m, openedFor);
  }

  stage.innerHTML = "";
  const vid = document.createElement("video");
  vid.controls = true;
  if (st.autoplay) vid.autoplay = true;
  if (st.loop) vid.loop = true;
  vid.src = m.fullUrl;
  stage.appendChild(vid);
  attachProgress(vid, m);

  const playable = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(vid.videoWidth > 0), 12000);
    const good = () => { clearTimeout(timer); resolve(true); };
    vid.addEventListener("canplay", good, { once: true });
    vid.addEventListener("loadeddata", good, { once: true });
    vid.addEventListener("error", () => { clearTimeout(timer); resolve(false); }, { once: true });
  });
  if (playable || lightboxIndex !== openedFor || $("#lightbox").classList.contains("hidden")) return;

  // Container refused natively (webm edge cases): give Vaultmux a shot.
  if (/\.(webm)$/i.test(m.title) && m.path) {
    const ok = await playViaVaultmux(stage, m, openedFor);
    if (ok || lightboxIndex !== openedFor) return;
  }

  return dropboxHandoff(stage, m, openedFor);
}

// Vaultmux: Vaultmall's streaming remuxer. Rewraps Matroska into
// fragmented MP4 in the browser and plays it through MSE with the
// compressed frames untouched. Returns true when playback engaged.
async function playViaVaultmux(stage, m, openedFor) {
  const st = getSettings();
  stage.innerHTML = `<div class="lb-loading">ENGAGING VAULTMUX…</div>`;
  try {
    const { TransmuxPlayer, transmuxSupported } = await import("./player/transmux-player.js");
    if (!transmuxSupported()) return false;
    if (lightboxIndex !== openedFor) return false;
    const src = getProvider("dropbox").module.transmuxSource((state.profile.connections || {}).dropbox || {}, m.path);
    const v2 = document.createElement("video");
    v2.controls = true;
    if (st.loop) v2.loop = true;
    stage.innerHTML = "";
    stage.appendChild(v2);
    const player = new TransmuxPlayer(v2, src, {
      onNote: (n) => toast("Vaultmux", n, ""),
    });
    activeTransmux = player;
    const info = await player.start();
    if (lightboxIndex !== openedFor) { killTransmux(); return false; }
    attachProgress(v2, m);
    if (st.autoplay) v2.play().catch(() => { /* gesture rules */ });
    // The subtle brag, once per session.
    if (!sessionStorage.getItem("vaultmall:mux-hello")) {
      sessionStorage.setItem("vaultmall:mux-hello", "1");
      toast("Vaultmux engaged", `Streaming this MKV natively (${info.videoCodec}). No conversion, no waiting.`, "ok");
    }
    return true;
  } catch (e) {
    killTransmux();
    return false;
  }
}

// Last resort: Dropbox's own transcoding player in a new tab.
async function dropboxHandoff(stage, m, openedFor) {
  stage.innerHTML = `<div class="lb-loading">GETTING A PLAYABLE LINK…</div>`;
  try {
    const link = await getProvider("dropbox").module.videoLink((state.profile.connections || {}).dropbox || {}, m.path);
    if (lightboxIndex !== openedFor) return;
    const panel = el("div", "lb-handoff", `
      <span class="mono">THIS BROWSER CAN'T DECODE THIS FILE'S STREAMS</span>
      <p>Dropbox's player converts it on their servers and plays it instantly.</p>`);
    const go = el("a", "btn btn-accent", "▶&nbsp;&nbsp;Play in the Dropbox player&nbsp;↗");
    go.href = link;
    go.target = "_blank";
    go.rel = "noopener";
    panel.appendChild(go);
    stage.innerHTML = "";
    stage.appendChild(panel);
  } catch (e) {
    if (lightboxIndex !== openedFor) return;
    stage.innerHTML = `<div class="lb-loading">${escapeHtml(e.message)}</div>`;
  }
}

// ============================================================
//  Toasts — errors also land in the notification bell
// ============================================================
function toast(title, msg, kind) {
  const t = el("div", `toast ${kind || ""}`,
    `<div class="toast-title">${escapeHtml(title)}</div>${msg ? `<div class="toast-msg">${escapeHtml(msg)}</div>` : ""}`);
  $("#toasts").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, 4200);
  if (kind === "err") notify(title, msg, "err");
}
