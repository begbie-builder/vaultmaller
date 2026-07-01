// ============================================================
//  Cloudflare Pages Function — Cloudinary Admin API proxy
//  Runs on YOUR Cloudflare deployment. It lets Vaultmall list
//  ALL of your Cloudinary media (no tagging required) by calling
//  the Admin API server-side — which the browser can't do
//  directly. Your API key/secret are sent from your own browser
//  to your own function over HTTPS and are never stored here.
// ============================================================

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const { cloudName, apiKey, apiSecret, folder } = body || {};
  if (!cloudName || !apiKey || !apiSecret) {
    return json({ error: "Missing Cloudinary cloud name, API key, or secret." }, 400);
  }

  const auth = "Basic " + btoa(`${apiKey}:${apiSecret}`);
  const resources = [];

  try {
    for (const type of ["image", "video"]) {
      let cursor = "";
      let pages = 0;
      do {
        const params = new URLSearchParams({ max_results: "100", type: "upload" });
        if (folder) params.set("prefix", String(folder).replace(/^\/+|\/+$/g, "") + "/");
        if (cursor) params.set("next_cursor", cursor);

        const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources/${type}?${params}`;
        const res = await fetch(url, { headers: { Authorization: auth } });

        if (res.status === 401) return json({ error: "Cloudinary rejected your API key or secret." }, 401);
        if (!res.ok) break; // e.g. no videos at all → move on

        const data = await res.json();
        for (const r of data.resources || []) {
          resources.push({ public_id: r.public_id, format: r.format, resource_type: r.resource_type || type });
        }
        cursor = data.next_cursor || "";
        pages++;
      } while (cursor && pages < 20); // safety cap (~2000 per type)
    }
  } catch (e) {
    return json({ error: e.message || "Cloudinary request failed." }, 502);
  }

  return json({ resources });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
