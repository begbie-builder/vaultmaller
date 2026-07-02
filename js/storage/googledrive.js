// ============================================================
//  Distributor: Google Drive
//  Uses Google Identity Services (GIS) to get a short-lived
//  read-only access token, then lists image/video files via the
//  Drive REST API. The token lives only in memory for the
//  session — we never store it. The OAuth Client ID is entered
//  by each user in the website (never hardcoded) and kept in
//  their own browser's storage.
// ============================================================

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
let tokenClient = null;
let accessToken = null;

// Always available — the user supplies their own Client ID in-app.
export const supported = true;

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Google sign-in."));
    document.head.appendChild(s);
  });
}

// Pops the Google consent screen and resolves once we have a token.
// clientId is the user's own OAuth Client ID, entered in the app.
export async function connect(clientId) {
  if (!clientId) throw new Error("Enter your Google OAuth Client ID first.");
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        resolve(true);
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

async function ensureToken(clientId) {
  if (accessToken) return accessToken;
  await connect(clientId);
  return accessToken;
}

// config: { clientId }
export async function list(config = {}) {
  const token = await ensureToken(config.clientId);
  const q = encodeURIComponent("(mimeType contains 'image/' or mimeType contains 'video/') and trashed = false");
  const fields = encodeURIComponent("files(id,name,mimeType,thumbnailLink,webContentLink,modifiedTime)");
  const items = [];
  let pageToken = "";

  do {
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,${fields}` +
      `&pageSize=100&orderBy=modifiedTime desc` +
      (pageToken ? `&pageToken=${pageToken}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google Drive returned ${res.status}.`);
    const data = await res.json();
    for (const f of data.files || []) {
      const isImage = f.mimeType.startsWith("image/");
      items.push({
        id: `gdrive:${f.id}`,
        title: f.name,
        type: isImage ? "image" : "video",
        // thumbnailLink is authless-friendly for display.
        thumbUrl: f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, "=s480") : "",
        fullUrl: `https://drive.google.com/file/d/${f.id}/view`,
        source: "gdrive",
        sub: "Google Drive",
        date: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
        // Videos stream through Drive's embedded player inside Vaultmall
        // (requires being signed into Google in this browser).
        embed: isImage ? "" : `https://drive.google.com/file/d/${f.id}/preview`,
        external: !isImage,
      });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return items;
}

export function disconnect() {
  accessToken = null;
}
