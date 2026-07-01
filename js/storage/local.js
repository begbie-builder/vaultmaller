// ============================================================
//  Distributor: Local Files
//  Reads media straight from a folder on the user's computer,
//  100% in the browser. Nothing is uploaded. Uses the
//  File System Access API and remembers the chosen folder in
//  IndexedDB so permission survives reloads.
// ============================================================

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv"];

export const supported = "showDirectoryPicker" in window;

// ---------- Tiny IndexedDB helper to persist the folder handle ----------
const DB_NAME = "vaultmall-local";
const STORE = "handles";

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDel(key) {
  const db = await idb();
  return new Promise((res) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
  });
}

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

// ---------- Public API ----------

// Ask the user to pick a folder. Returns the folder name on success.
export async function pickFolder(uid) {
  if (!supported) throw new Error("Your browser can't read local folders. Try Chrome, Edge, or Brave on desktop.");
  const handle = await window.showDirectoryPicker({ mode: "read" });
  await idbSet(`dir:${uid}`, handle);
  return handle.name;
}

export async function hasSavedFolder(uid) {
  const handle = await idbGet(`dir:${uid}`);
  return !!handle;
}

export async function savedFolderName(uid) {
  const handle = await idbGet(`dir:${uid}`);
  return handle ? handle.name : null;
}

export async function forget(uid) {
  await idbDel(`dir:${uid}`);
}

async function ensurePermission(handle) {
  const opts = { mode: "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

// True only if we can already read without prompting (no gesture needed).
export async function permissionGranted(uid) {
  const handle = await idbGet(`dir:${uid}`);
  if (!handle) return false;
  return (await handle.queryPermission({ mode: "read" })) === "granted";
}

// Walk the folder tree and return media items with local object URLs.
export async function list(uid, { onProgress } = {}) {
  const handle = await idbGet(`dir:${uid}`);
  if (!handle) throw new Error("No folder connected yet.");
  const ok = await ensurePermission(handle);
  if (!ok) throw new Error("Permission to read the folder was denied.");

  const items = [];
  let scanned = 0;

  async function walk(dirHandle, prefix) {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === "directory") {
        // Skip hidden/system folders to stay fast and tidy.
        if (name.startsWith(".")) continue;
        await walk(entry, `${prefix}${name}/`);
      } else {
        const ext = extOf(name);
        const isImage = IMAGE_EXT.includes(ext);
        const isVideo = VIDEO_EXT.includes(ext);
        if (!isImage && !isVideo) continue;
        const file = await entry.getFile();
        const url = URL.createObjectURL(file);
        items.push({
          id: `local:${prefix}${name}`,
          title: name,
          type: isImage ? "image" : "video",
          thumbUrl: url,
          fullUrl: url,
          source: "local",
          sub: prefix || handle.name,
          size: file.size,
        });
        scanned++;
        if (onProgress && scanned % 12 === 0) onProgress(scanned);
      }
    }
  }

  await walk(handle, "");
  return items;
}
