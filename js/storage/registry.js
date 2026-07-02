// ============================================================
//  Distributor registry
//  One place that describes every storage service Vaultmall can
//  show. Adding a new distributor = add an entry here plus a
//  small module like the ones in this folder. See the README
//  section "Adding your own distributor".
// ============================================================
import * as local from "./local.js";
import * as cloudinary from "./cloudinary.js";
import * as gdrive from "./googledrive.js";
import * as dropbox from "./dropbox.js";
import * as mega from "./mega.js";

export const PROVIDERS = {
  local: {
    id: "local",
    name: "Local Files",
    desc: "A folder on this computer",
    icon: "🖥",
    color: "#6366f1",
    kind: "device", // lives on this device, not restorable from the cloud alone
    available: local.supported,
    module: local,
  },
  cloudinary: {
    id: "cloudinary",
    name: "Cloudinary",
    desc: "Your whole Cloudinary library",
    icon: "☁",
    color: "#3448c5",
    kind: "cloud",
    available: true,
    fields: [
      { key: "cloudName", label: "Cloud name", placeholder: "your-cloud-name", required: true },
      { key: "apiKey", label: "API Key", placeholder: "123456789012345", required: true },
      { key: "apiSecret", label: "API Secret", placeholder: "your-api-secret", required: true, type: "password" },
      { key: "folder", label: "Folder (optional)", placeholder: "leave blank for everything", required: false },
    ],
    module: cloudinary,
  },
  gdrive: {
    id: "gdrive",
    name: "Google Drive",
    desc: "Your Drive photos and videos",
    icon: "▲",
    color: "#1a73e8",
    kind: "oauth",
    available: gdrive.supported,
    module: gdrive,
  },

  dropbox: {
    id: "dropbox",
    name: "Dropbox",
    desc: "Your Dropbox media",
    icon: "◇",
    color: "#0061ff",
    kind: "cloud",
    available: true,
    fields: [
      { key: "accessToken", label: "Access token", placeholder: "sl.xxxx…", required: true, type: "password" },
      { key: "folder", label: "Folder (optional)", placeholder: "leave blank for everything", required: false },
    ],
    module: dropbox,
  },
  mega: {
    id: "mega",
    name: "MEGA",
    desc: "A MEGA shared folder",
    icon: "◉",
    color: "#d9272e",
    kind: "encrypted", // decrypts in-browser; loaded on click, not on page load
    available: true,
    beta: true,
    fields: [
      { key: "folderUrl", label: "Shared folder link", placeholder: "https://mega.nz/folder/…#key", required: true },
    ],
    module: mega,
  },

  // ---- Easy-to-add next: scaffolded, marked "soon" until wired ----
  onedrive: {
    id: "onedrive",
    name: "OneDrive",
    desc: "Microsoft OneDrive media",
    icon: "☁",
    color: "#0364b8",
    kind: "oauth",
    available: false,
    soon: true,
  },
  s3: {
    id: "s3",
    name: "S3 / R2",
    desc: "Any S3-compatible bucket",
    icon: "◪",
    color: "#e2761b",
    kind: "cloud",
    available: false,
    soon: true,
  },
  url: {
    id: "url",
    name: "Direct Links",
    desc: "Paste media URLs to pin",
    icon: "🔗",
    color: "#14b8a6",
    kind: "cloud",
    available: false,
    soon: true,
  },
};

export function providerList() {
  return Object.values(PROVIDERS);
}

export function getProvider(id) {
  return PROVIDERS[id];
}
