// ============================================================
//  Distributor: Cloudinary
//  Lists ALL of your Cloudinary media — no tagging required.
//  It calls a small serverless helper (functions/api/cloudinary.js)
//  that runs on your own Cloudflare deployment and talks to the
//  Cloudinary Admin API for you. Your key/secret live only in your
//  own browser and are sent to your own function over HTTPS.
// ============================================================

// Build delivery URLs from a public_id (these are public CDN URLs).
function thumb(cloud, type, publicId, format) {
  const t = "c_fill,w_480,h_480,q_auto,f_auto";
  return `https://res.cloudinary.com/${cloud}/${type}/upload/${t}/${publicId}.${format}`;
}
function full(cloud, type, publicId, format) {
  return `https://res.cloudinary.com/${cloud}/${type}/upload/q_auto/${publicId}.${format}`;
}

function toItem(cloud, r) {
  const type = r.resource_type === "video" ? "video" : "image";
  const fmt = r.format || (type === "video" ? "mp4" : "jpg");
  return {
    id: `cloudinary:${type}:${r.public_id}`,
    title: r.public_id.split("/").pop(),
    type,
    // For videos Cloudinary renders a still frame as a jpg thumbnail.
    thumbUrl: thumb(cloud, type, r.public_id, type === "video" ? "jpg" : fmt),
    fullUrl: full(cloud, type, r.public_id, fmt),
    source: "cloudinary",
    sub: "Cloudinary",
  };
}

// Marks an error as "soft" — the config is still worth saving; it just
// couldn't be verified right now (e.g. the helper isn't running locally).
function soft(msg) {
  return Object.assign(new Error(msg), { soft: true });
}

// config: { cloudName, apiKey, apiSecret, folder? }
export async function list(config) {
  const cloud = (config.cloudName || "").trim();
  if (!cloud) throw new Error("Missing Cloudinary cloud name.");
  if (!config.apiKey || !config.apiSecret) {
    throw new Error("Add your Cloudinary API Key and API Secret.");
  }

  let res;
  try {
    res = await fetch("/api/cloudinary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cloudName: cloud,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        folder: config.folder || "",
      }),
    });
  } catch {
    throw soft("Couldn't reach the Cloudinary helper. It runs on your deployed Cloudflare site (or `npx wrangler pages dev`).");
  }

  if (res.status === 404 || res.status === 405) {
    throw soft("Cloudinary listing needs the serverless helper, which only runs on your deployed Cloudflare site (or via `npx wrangler pages dev`).");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Cloudinary error ${res.status}.`);

  return (data.resources || []).map((r) => toItem(cloud, r));
}
