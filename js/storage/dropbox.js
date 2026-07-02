// ============================================================
//  Distributor: Dropbox
//  Lists image/video files in your Dropbox using the public
//  HTTP API and a personal access token you paste in the app.
//  The token is kept only in your own browser. Temporary,
//  streamable links are fetched per file for viewing.
// ============================================================

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
  if (res.status === 401) throw new Error("Dropbox token is invalid or expired. Generate a fresh one.");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dropbox error ${res.status}. ${text.slice(0, 120)}`);
  }
  return res.json();
}

// config: { accessToken, folder? }
export async function list(config) {
  const token = (config.accessToken || "").trim();
  if (!token) throw new Error("Add your Dropbox access token.");
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
      date: e.server_modified ? Date.parse(e.server_modified) : 0,
    };
  });

  return items.filter(Boolean);
}
