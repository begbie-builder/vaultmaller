// ============================================================
//  Vaultmall — main application
// ============================================================
import { isConfigured } from "./firebase-config.js";
import { PROVIDERS, providerList, getProvider } from "./storage/registry.js";
import * as store from "./store.js";

// Firebase pulls its SDK from a CDN. We load it *lazily* so a slow or
// blocked network never leaves the user staring at a blank splash — the
// UI renders first, then Firebase attaches. FB holds the module once ready.
let FB = null;

// ---------- Tiny DOM helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

// ---------- App state ----------
const state = {
  user: null,
  profile: { username: "user", connections: {} },
  media: [],            // combined media items currently loaded
  bySource: {},         // sourceId -> items[]
  needsReconnect: {},   // sourceId -> true if it needs a click to reload
  activeView: "all",    // "all" or a provider id
  filter: "all",        // all | image | video
  search: "",
  authMode: "login",
};

// ============================================================
//  Boot
// ============================================================
window.addEventListener("DOMContentLoaded", () => {
  applyTheme(localStorage.getItem("vm-theme") || "dark");

  setTimeout(() => $("#splash").classList.add("fade"), 400);
  setTimeout(() => $("#splash").classList.add("hidden"), 900);

  // Always show the base UI immediately, then bring Firebase online.
  showAuth();
  wireAuthUI();
  wireAppUI();
  bootFirebase();
});

async function bootFirebase() {
  if (!isConfigured()) {
    showAuthError(
      "⚙️ Almost there! Open js/firebase-config.js and paste your Firebase keys (README Step 1), then reload."
    );
    $("#auth-submit").disabled = true;
    return;
  }

  try {
    FB = await import("./firebase.js");
    FB.initFirebase();
  } catch (e) {
    showAuthError(
      (e && e.message && !/Failed to fetch|import/.test(e.message))
        ? e.message
        : "Couldn't reach Firebase. Check your internet connection and reload."
    );
    $("#auth-submit").disabled = true;
    return;
  }

  FB.watchAuth(async (user) => {
    if (user) {
      state.user = user;
      // Username comes from the login; connections come from this
      // browser's private storage — no server database involved.
      state.profile = {
        username: FB.usernameOf(user),
        connections: store.loadConnections(user.uid),
      };
      enterApp();
    } else {
      state.user = null;
      showAuth();
    }
  });
}

// ============================================================
//  Theme
// ============================================================
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("vm-theme", theme);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
}

// ============================================================
//  Auth screen
// ============================================================
function showAuth() {
  $("#auth-screen").classList.remove("hidden");
  $("#app").classList.add("hidden");
}
function showAuthError(msg) {
  const box = $("#auth-error");
  box.textContent = msg;
  box.classList.remove("hidden");
}
function clearAuthError() { $("#auth-error").classList.add("hidden"); }

function wireAuthUI() {
  $$(".auth-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      state.authMode = tab.dataset.mode;
      $$(".auth-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
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
    $(".btn-label").textContent = "Please wait…";
    try {
      if (state.authMode === "login") await FB.logIn(username, password);
      else await FB.signUp(username, password);
      // watchAuth handles the transition into the app.
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
  $("#auth-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");

  const name = state.profile.username || "user";
  $("#user-name").textContent = name;
  $("#user-avatar").textContent = name.slice(0, 1).toUpperCase();

  renderNav();
  loadAllMedia();
}

function wireAppUI() {
  $("#logout-btn").addEventListener("click", () => FB.logOut());
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#add-distributor-btn").addEventListener("click", openAddModal);
  $$("[data-open-add]").forEach((b) => b.addEventListener("click", openAddModal));

  // Modals close
  $$("[data-close-modal]").forEach((b) => b.addEventListener("click", () => hide("#add-modal")));
  $$("[data-close-config]").forEach((b) => b.addEventListener("click", () => hide("#config-modal")));
  $("#add-modal").addEventListener("click", (e) => { if (e.target.id === "add-modal") hide("#add-modal"); });
  $("#config-modal").addEventListener("click", (e) => { if (e.target.id === "config-modal") hide("#config-modal"); });

  // Search + filters
  $("#search-input").addEventListener("input", (e) => { state.search = e.target.value.toLowerCase(); renderGrid(); });
  $$(".seg").forEach((s) =>
    s.addEventListener("click", () => {
      state.filter = s.dataset.filter;
      $$(".seg").forEach((x) => x.classList.toggle("is-active", x === s));
      renderGrid();
    })
  );

  // Lightbox
  $("[data-close-lightbox]").addEventListener("click", closeLightbox);
  $("[data-lb-prev]").addEventListener("click", () => stepLightbox(-1));
  $("[data-lb-next]").addEventListener("click", () => stepLightbox(1));
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if ($("#lightbox").classList.contains("hidden")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") stepLightbox(-1);
    if (e.key === "ArrowRight") stepLightbox(1);
  });
}

const show = (sel) => $(sel).classList.remove("hidden");
const hide = (sel) => $(sel).classList.add("hidden");

// ============================================================
//  Sidebar nav (connected distributors)
// ============================================================
function renderNav() {
  const nav = $("#distributor-nav");
  // Remove previously injected distributor buttons (keep "All" + heading).
  $$(".nav-item[data-view]:not([data-view='all'])", nav).forEach((n) => n.remove());

  const connections = state.profile.connections || {};
  const ids = Object.keys(connections);

  if (ids.length === 0) {
    const hint = el("div", "nav-item", `<span class="nav-icon">·</span> No storage yet`);
    hint.style.opacity = "0.6";
    hint.style.pointerEvents = "none";
    hint.dataset.view = "__hint";
    nav.appendChild(hint);
  }

  ids.forEach((id) => {
    const p = getProvider(id);
    if (!p) return;
    const count = (state.bySource[id] || []).length;
    const btn = el(
      "button",
      "nav-item",
      `<span class="nav-icon" style="color:${p.color}">${p.icon}</span> ${p.name}
       <span class="badge">${count}</span>`
    );
    btn.dataset.view = id;
    btn.addEventListener("click", () => setView(id));
    nav.appendChild(btn);
  });

  $("[data-view='all']").onclick = () => setView("all");
  highlightNav();
}

function highlightNav() {
  $$(".nav-item[data-view]").forEach((n) => n.classList.toggle("is-active", n.dataset.view === state.activeView));
}

function setView(view) {
  state.activeView = view;
  highlightNav();
  const p = getProvider(view);
  $("#view-title").textContent = view === "all" ? "All media" : p ? p.name : "Media";
  renderGrid();
}

// ============================================================
//  Add-storage modal
// ============================================================
function openAddModal() {
  const grid = $("#provider-grid");
  grid.innerHTML = "";
  const connections = state.profile.connections || {};

  providerList().forEach((p) => {
    const connected = !!connections[p.id];
    const disabled = p.soon || (p.available === false && !p.soon);
    const card = el("button", `provider${p.soon ? " soon" : ""}${connected ? " connected" : ""}`);
    const tag = p.soon ? "Soon" : p.beta ? "Beta" : "";
    card.innerHTML = `
      <div class="p-icon" style="background:${p.color}">${p.icon}</div>
      <div>
        <div class="p-name">${p.name}</div>
        <div class="p-desc">${p.desc}</div>
      </div>
      ${tag ? `<span class="soon-tag">${tag}</span>` : ""}
      ${connected ? '<span class="p-check">✓</span>' : ""}`;
    if (!disabled) card.addEventListener("click", () => { hide("#add-modal"); openConfig(p.id); });
    if (p.available === false && !p.soon) {
      card.classList.add("soon");
      card.querySelector(".p-desc").textContent = "Not available in this browser";
    }
    grid.appendChild(card);
  });

  show("#add-modal");
}

// ============================================================
//  Per-provider config modal
// ============================================================
function openConfig(providerId) {
  const p = getProvider(providerId);
  const body = $("#config-body");
  $("#config-title").textContent = p.name;
  body.innerHTML = "";

  const existing = (state.profile.connections || {})[providerId] || {};

  if (providerId === "local") return renderLocalConfig(p, body, existing);
  if (providerId === "gdrive") return renderOAuthConfig(p, body, existing);
  return renderFieldConfig(p, body, existing);
}

// ---- Local files ----
function renderLocalConfig(p, body, existing) {
  const connected = !!existing.folderName;
  body.appendChild(el("div", "config-note",
    `<strong>100% private.</strong> Vaultmall reads the folder you choose directly in your browser.
     Nothing is uploaded anywhere. You'll be asked to grant read permission.`));

  const status = el("p", "config-hint",
    connected ? `Connected folder: <code>${existing.folderName}</code>` : "No folder chosen yet.");
  body.appendChild(status);

  const actions = el("div", "config-actions");
  const pickBtn = el("button", "btn btn-primary", connected ? "Choose a different folder" : "Choose a folder");
  pickBtn.addEventListener("click", async () => {
    try {
      const folderName = await p.module.pickFolder(state.user.uid);
      store.saveConnection(state.user.uid, "local", { folderName });
      state.profile.connections.local = { folderName };
      toast("Folder connected", folderName, "ok");
      hide("#config-modal");
      renderNav();
      await loadSource("local");
      setView("local");
    } catch (e) {
      if (e && e.name === "AbortError") return; // user cancelled the picker
      toast("Couldn't connect folder", e.message, "err");
    }
  });
  actions.appendChild(pickBtn);

  if (connected) {
    const rm = el("button", "btn btn-danger", "Disconnect");
    rm.addEventListener("click", async () => {
      await p.module.forget(state.user.uid);
      await disconnectProvider("local");
    });
    actions.appendChild(rm);
  }
  body.appendChild(actions);
  show("#config-modal");
}

// ---- Google Drive (OAuth — user supplies their own Client ID) ----
function renderOAuthConfig(p, body, existing) {
  const connected = !!existing.connected;

  // The user pastes their own Google OAuth Client ID here. It's kept
  // only in this browser (localStorage), never in the app's code.
  const field = el("label", "field");
  field.appendChild(el("span", null, "Your Google OAuth Client ID *"));
  const input = el("input");
  input.type = "text";
  input.placeholder = "1234-abc.apps.googleusercontent.com";
  input.value = existing.clientId || "";
  field.appendChild(input);
  body.appendChild(field);

  body.appendChild(el("div", "config-note",
    `<strong>Read-only, and yours alone.</strong> Vaultmall only asks Google to <em>view</em> your
     Drive media. The Client ID is saved in <em>your</em> browser; the access token stays in memory
     for this session only and is never stored. See the README (Step 3) for how to create a Client ID
     — remember to add this site's URL to your Client's <em>Authorized JavaScript origins</em>.`));

  const actions = el("div", "config-actions");
  const btn = el("button", "btn btn-primary", connected ? "Reconnect Google Drive" : "Connect Google Drive");
  btn.addEventListener("click", async () => {
    const clientId = input.value.trim();
    if (!clientId) { toast("Client ID required", "Paste your Google OAuth Client ID first.", "err"); return; }
    btn.disabled = true;
    btn.textContent = "Opening Google…";
    try {
      await p.module.connect(clientId);
      const cfg = { connected: true, clientId };
      store.saveConnection(state.user.uid, "gdrive", cfg);
      state.profile.connections.gdrive = cfg;
      toast("Google Drive connected", "", "ok");
      hide("#config-modal");
      renderNav();
      await loadSource("gdrive");
      setView("gdrive");
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
  show("#config-modal");
}

// ---- Field-based providers (Cloudinary, etc.) ----
function renderFieldConfig(p, body, existing) {
  const form = el("form", "config-body");
  (p.fields || []).forEach((f) => {
    const wrap = el("label", "field");
    wrap.appendChild(el("span", null, f.label + (f.required ? " *" : "")));
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
    cloudinary: `<strong>Shows everything — no tags needed.</strong> Copy your
       <em>API Key</em> and <em>API Secret</em> from the Cloudinary dashboard. They stay in
       your browser and are used only by your own site's serverless helper to list your media.
       (Listing runs on your deployed Cloudflare site, or locally via <code>npx wrangler pages dev</code>.)`,
    dropbox: `<strong>Bring your own token.</strong> In the Dropbox App Console create an app,
       give it the <code>files.metadata.read</code> and <code>files.content.read</code> scopes,
       then generate an <em>access token</em> and paste it here. It's kept only in your browser.`,
    mega: `<strong>Beta.</strong> Paste a MEGA <em>shared folder link</em> (it contains the
       decryption key). Because MEGA is end-to-end encrypted, files are decrypted in your browser
       when shown, so this works best for smaller folders.`,
  };
  if (NOTES[p.id]) form.appendChild(el("div", "config-note", NOTES[p.id]));

  const actions = el("div", "config-actions");
  const save = el("button", "btn btn-primary", "Connect");
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
      // Validate by listing once, and reuse the result (no double load).
      const items = await p.module.list(config);
      store.saveConnection(state.user.uid, p.id, config);
      state.profile.connections[p.id] = config;
      state.bySource[p.id] = items || [];
      delete state.needsReconnect[p.id];
      rebuildMedia();
      toast(`${p.name} connected`, "", "ok");
      hide("#config-modal");
      renderNav();
      setView(p.id);
    } catch (err) {
      if (err && err.soft) {
        // Config looks fine but couldn't be verified now (e.g. helper not
        // running locally). Save it so it works once deployed.
        store.saveConnection(state.user.uid, p.id, config);
        state.profile.connections[p.id] = config;
        state.needsReconnect[p.id] = true;
        toast(`${p.name} saved`, err.message, "");
        hide("#config-modal");
        renderNav();
        setView(p.id);
        return;
      }
      toast(`${p.name} error`, err.message, "err");
      save.disabled = false;
      save.textContent = "Connect";
    }
  });

  body.appendChild(form);
  show("#config-modal");
}

async function disconnectProvider(id) {
  store.removeConnection(state.user.uid, id);
  delete state.profile.connections[id];
  delete state.bySource[id];
  state.media = state.media.filter((m) => m.source !== id);
  if (state.activeView === id) state.activeView = "all";
  hide("#config-modal");
  toast("Disconnected", getProvider(id).name, "ok");
  renderNav();
  renderGrid();
}

// ============================================================
//  Media loading
// ============================================================
async function loadAllMedia() {
  const connections = state.profile.connections || {};
  const ids = Object.keys(connections);
  if (ids.length === 0) {
    showEmpty();
    return;
  }
  showSkeleton();
  // Decide what we can load without a fresh user gesture. Cloud services
  // (Cloudinary) just fetch. Device/OAuth services need the user to click
  // "Reconnect" first, so we don't ambush them with popups on load.
  const toLoad = [];
  for (const id of ids) {
    const p = getProvider(id);
    if (!p) continue;
    if (p.kind === "cloud") { toLoad.push(id); continue; }
    if (id === "local" && (await p.module.permissionGranted(state.user.uid).catch(() => false))) {
      toLoad.push(id);
    } else {
      state.needsReconnect[id] = true; // show a Reconnect affordance
      state.bySource[id] = [];
    }
  }
  // Load each source independently so one failure doesn't block the rest.
  await Promise.allSettled(toLoad.map((id) => loadSource(id, { silent: true })));
  rebuildMedia();
  renderGrid();
  renderNav();
}

async function loadSource(id, { silent } = {}) {
  const p = getProvider(id);
  if (!p || !p.module || typeof p.module.list !== "function") return;
  const config = (state.profile.connections || {})[id] || {};
  try {
    let items;
    // Each distributor has its own call shape; keep it explicit.
    if (id === "local") {
      items = await p.module.list(state.user.uid, { onProgress: () => {} });
    } else {
      items = await p.module.list(config);
    }
    state.bySource[id] = items || [];
    delete state.needsReconnect[id];
  } catch (e) {
    state.bySource[id] = [];
    if (!silent) toast(`${p.name} couldn't load`, e.message, "err");
  }
  rebuildMedia();
  if (!silent) { renderGrid(); renderNav(); }
}

// Triggered by a user click, so permission prompts / OAuth popups are allowed.
async function reconnect(id) {
  const p = getProvider(id);
  showSkeleton();
  await loadSource(id); // click provides the gesture the browser requires
  setView(id);
}

function rebuildMedia() {
  state.media = Object.values(state.bySource).flat();
}

// ============================================================
//  Grid rendering
// ============================================================
function visibleItems() {
  let items = state.activeView === "all"
    ? state.media
    : (state.bySource[state.activeView] || []);
  if (state.filter !== "all") items = items.filter((m) => m.type === state.filter);
  if (state.search) items = items.filter((m) => m.title.toLowerCase().includes(state.search));
  return items;
}

function showEmpty() {
  hide("#skeleton"); hide("#media-grid"); show("#empty-state");
}
function showSkeleton() {
  hide("#empty-state"); hide("#media-grid");
  const sk = $("#skeleton");
  sk.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    sk.appendChild(el("div", "skel", `<div class="skel-thumb"></div><div class="skel-line"></div><div class="skel-line short"></div>`));
  }
  show("#skeleton");
}

function renderGrid() {
  hide("#skeleton");
  const items = visibleItems();
  $("#view-count").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;

  if ((state.profile.connections ? Object.keys(state.profile.connections).length : 0) === 0) {
    showEmpty();
    return;
  }
  hide("#empty-state");

  const grid = $("#media-grid");
  grid.innerHTML = "";

  // A single device/OAuth distributor that needs a click to (re)load.
  if (state.activeView !== "all" && state.needsReconnect[state.activeView]) {
    const p = getProvider(state.activeView);
    const box = el("div", "empty-state",
      `<div class="empty-illustration"></div>
       <h3>${p.name} is ready to reconnect</h3>
       <p>For your privacy, ${p.name} needs one click to load in this session.</p>`);
    const btn = el("button", "btn btn-primary", `Reconnect ${p.name}`);
    btn.addEventListener("click", () => reconnect(state.activeView));
    box.appendChild(btn);
    grid.appendChild(box);
    show("#media-grid");
    return;
  }

  if (items.length === 0) {
    grid.appendChild(el("div", "empty-state",
      `<div class="empty-illustration"></div><h3>Nothing here</h3><p>No media matches this view.</p>`));
    show("#media-grid");
    return;
  }

  state._visible = items;
  items.forEach((m, i) => {
    const p = getProvider(m.source) || { color: "#888", name: m.source };
    const card = el("div", "card");
    card.style.animationDelay = `${Math.min(i, 20) * 0.02}s`;
    const media = m.type === "video" && !m.external
      ? `<video src="${m.fullUrl}" muted preload="metadata"></video>`
      : m.thumbUrl
        ? `<img loading="lazy" src="${m.thumbUrl}" alt="${escapeHtml(m.title)}" onerror="this.style.display='none';this.parentNode.querySelector('.placeholder-icon').style.display='flex'">`
        : "";
    card.innerHTML = `
      <div class="card-thumb">
        ${media}
        <span class="placeholder-icon" style="display:${m.thumbUrl ? "none" : "flex"}">${m.type === "video" ? "▶" : "🖼"}</span>
        <span class="card-badge"><span class="swatch" style="background:${p.color}"></span>${p.name}</span>
        <span class="type-tag">${m.type}</span>
      </div>
      <div class="card-meta">
        <div class="card-title">${escapeHtml(m.title)}</div>
        <div class="card-sub">${escapeHtml(m.sub || "")}</div>
      </div>`;
    card.addEventListener("click", () => openLightbox(i));
    grid.appendChild(card);
  });
  show("#media-grid");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============================================================
//  Lightbox
// ============================================================
let lightboxIndex = 0;
function openLightbox(i) {
  lightboxIndex = i;
  renderLightbox();
  show("#lightbox");
}
function closeLightbox() { hide("#lightbox"); $("#lightbox-stage").innerHTML = ""; }
function stepLightbox(dir) {
  const items = state._visible || [];
  if (!items.length) return;
  lightboxIndex = (lightboxIndex + dir + items.length) % items.length;
  renderLightbox();
}
async function renderLightbox() {
  const items = state._visible || [];
  const m = items[lightboxIndex];
  if (!m) return;
  const stage = $("#lightbox-stage");
  $("#lightbox-caption").textContent = `${m.title} · ${getProvider(m.source)?.name || m.source}`;

  // Some sources (e.g. MEGA) decrypt the file only when opened.
  if (!m.fullUrl && typeof m.resolveFull === "function") {
    stage.innerHTML = `<div class="lb-loading">Decrypting…</div>`;
    const openedFor = lightboxIndex;
    try {
      const url = await m.resolveFull();
      m.fullUrl = url;
      if (m.type === "image") m.thumbUrl = m.thumbUrl || url;
      if (lightboxIndex !== openedFor) return; // user navigated away meanwhile
    } catch {
      stage.innerHTML = `<div class="lb-loading">Couldn't load this file.</div>`;
      return;
    }
  }

  if (m.external) {
    stage.innerHTML = `<a class="btn btn-primary" href="${m.fullUrl}" target="_blank" rel="noopener">Open in ${getProvider(m.source)?.name || "source"} ↗</a>`;
  } else if (m.type === "video") {
    stage.innerHTML = `<video src="${m.fullUrl}" controls autoplay></video>`;
  } else {
    stage.innerHTML = `<img src="${m.fullUrl}" alt="${escapeHtml(m.title)}">`;
  }
}

// ============================================================
//  Toasts
// ============================================================
function toast(title, msg, kind) {
  const t = el("div", `toast ${kind || ""}`, `<div class="toast-title">${escapeHtml(title)}</div>${msg ? `<div class="toast-msg">${escapeHtml(msg)}</div>` : ""}`);
  $("#toasts").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, 4200);
}
