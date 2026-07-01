// ============================================================
//  Distributor: MEGA  (beta)
//  MEGA is end-to-end encrypted and has no simple REST API, so
//  media must be decrypted in the browser. Vaultmall reads a
//  MEGA *shared folder link* (which contains the decryption key)
//  using the megajs library, loaded on demand from a CDN.
//
//  Because every file must be downloaded + decrypted to be shown,
//  MEGA is best for smaller folders. Images load eagerly (capped);
//  videos and extras load only when you open them.
// ============================================================

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv", "mkv"];
const EAGER_IMAGE_CAP = 60; // don't auto-download more than this many images

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}
const isImage = (n) => IMAGE_EXT.includes(extOf(n));
const isVideo = (n) => VIDEO_EXT.includes(extOf(n));

// Load megajs once, lazily. Contained so a CDN failure can't crash the app.
let megaPromise = null;
function loadMega() {
  if (!megaPromise) {
    megaPromise = import("https://esm.sh/megajs@1.3.6?bundle").catch((e) => {
      megaPromise = null;
      throw new Error("Couldn't load the MEGA library (check your connection).");
    });
  }
  return megaPromise;
}

async function toBlobUrl(file) {
  // megajs exposes downloadBuffer() → Uint8Array/Buffer of the decrypted file.
  const buf = await file.downloadBuffer();
  return URL.createObjectURL(new Blob([buf]));
}

// config: { folderUrl }
export async function list(config) {
  const url = (config.folderUrl || "").trim();
  if (!url) throw new Error("Paste a MEGA shared folder link (mega.nz/folder/…).");
  if (!/mega\.nz\/(folder|file)\//.test(url)) throw new Error("That doesn't look like a MEGA share link.");

  const { File } = await loadMega();

  const folder = File.fromURL(url);
  await folder.loadAttributes();

  // Flatten the folder tree into a list of files.
  const files = [];
  (function walk(node) {
    for (const child of node.children || []) {
      if (child.directory) walk(child);
      else files.push(child);
    }
  })(folder);

  const media = files.filter((f) => isImage(f.name) || isVideo(f.name));

  const items = [];
  let eagerImages = 0;
  for (const f of media) {
    const type = isImage(f.name) ? "image" : "video";
    const item = {
      id: `mega:${f.nodeId || f.downloadId || f.name}`,
      title: f.name,
      type,
      thumbUrl: "",
      fullUrl: "",
      source: "mega",
      sub: "MEGA",
    };

    if (type === "image" && eagerImages < EAGER_IMAGE_CAP) {
      eagerImages++;
      try {
        const u = await toBlobUrl(f);
        item.thumbUrl = u;
        item.fullUrl = u;
      } catch {
        item.resolveFull = () => toBlobUrl(f); // fall back to lazy on failure
      }
    } else {
      // Videos and overflow images decrypt only when opened.
      item.resolveFull = () => toBlobUrl(f);
    }
    items.push(item);
  }

  return items;
}
