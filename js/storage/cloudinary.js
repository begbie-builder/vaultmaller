// ============================================================
//  Distributor: Cloudinary
//  Lists your media by a shared tag using Cloudinary's public
//  "resource list" delivery endpoint. This means we only ever
//  need your CLOUD NAME — never your API secret — so nothing
//  sensitive is stored in the browser. (README explains how to
//  turn on "Resource list" and tag your files.)
// ============================================================

// Build a thumbnail-sized delivery URL with on-the-fly transforms.
function thumb(cloud, type, publicId, format) {
  const t = "c_fill,w_480,h_480,q_auto,f_auto";
  return `https://res.cloudinary.com/${cloud}/${type}/upload/${t}/${publicId}.${format}`;
}
function full(cloud, type, publicId, format) {
  return `https://res.cloudinary.com/${cloud}/${type}/upload/q_auto/${publicId}.${format}`;
}

async function listByTag(cloud, resourceType, tag) {
  // Public JSON list of every asset carrying `tag`.
  const url = `https://res.cloudinary.com/${cloud}/${resourceType}/list/${encodeURIComponent(tag)}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return []; // no assets with this tag yet
  if (!res.ok) {
    throw new Error(
      `Cloudinary returned ${res.status}. Make sure "Resource list" is enabled and your files are tagged.`
    );
  }
  const data = await res.json();
  return Array.isArray(data.resources) ? data.resources : [];
}

// config: { cloudName, tag }
export async function list(config) {
  const cloud = (config.cloudName || "").trim();
  const tag = (config.tag || "vaultmall").trim();
  if (!cloud) throw new Error("Missing Cloudinary cloud name.");

  const [images, videos] = await Promise.all([
    listByTag(cloud, "image", tag),
    listByTag(cloud, "video", tag).catch(() => []),
  ]);

  const items = [];
  for (const r of images) {
    items.push({
      id: `cloudinary:img:${r.public_id}`,
      title: r.public_id.split("/").pop(),
      type: "image",
      thumbUrl: thumb(cloud, "image", r.public_id, r.format || "jpg"),
      fullUrl: full(cloud, "image", r.public_id, r.format || "jpg"),
      source: "cloudinary",
      sub: "Cloudinary",
    });
  }
  for (const r of videos) {
    items.push({
      id: `cloudinary:vid:${r.public_id}`,
      title: r.public_id.split("/").pop(),
      type: "video",
      // Cloudinary can render a still frame from a video as a jpg.
      thumbUrl: thumb(cloud, "video", r.public_id, "jpg"),
      fullUrl: full(cloud, "video", r.public_id, r.format || "mp4"),
      source: "cloudinary",
      sub: "Cloudinary",
    });
  }
  return items;
}

// Optional: unsigned upload straight from the browser.
// config needs { cloudName, uploadPreset, tag }
export async function upload(config, file, onProgress) {
  const cloud = (config.cloudName || "").trim();
  if (!config.uploadPreset) throw new Error("Add an unsigned upload preset to enable uploads.");
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", config.uploadPreset);
  form.append("tags", config.tag || "vaultmall");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloud}/auto/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error("Upload failed")));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(form);
  });
}
