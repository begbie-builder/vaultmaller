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

export const PROVIDERS = {
  local: {
    id: "local",
    name: "Local Files",
    desc: "Read a folder on this computer",
    icon: "🖥",
    color: "#6366f1",
    kind: "device", // lives on this device, not restorable from the cloud alone
    available: local.supported,
    module: local,
  },
  cloudinary: {
    id: "cloudinary",
    name: "Cloudinary",
    desc: "Up to 25 GB free media CDN",
    icon: "☁",
    color: "#3448c5",
    kind: "cloud",
    available: true,
    fields: [
      { key: "cloudName", label: "Cloud name", placeholder: "your-cloud-name", required: true },
      { key: "tag", label: "Tag to show", placeholder: "vaultmall", required: false, default: "vaultmall" },
      { key: "uploadPreset", label: "Upload preset (optional)", placeholder: "unsigned_preset", required: false },
    ],
    module: cloudinary,
  },
  gdrive: {
    id: "gdrive",
    name: "Google Drive",
    desc: "Your Drive photos & videos",
    icon: "▲",
    color: "#1a73e8",
    kind: "oauth",
    available: gdrive.supported,
    module: gdrive,
  },

  // ---- Easy-to-add next: scaffolded, marked "soon" until wired ----
  dropbox: {
    id: "dropbox",
    name: "Dropbox",
    desc: "Media from your Dropbox",
    icon: "◇",
    color: "#0061ff",
    kind: "oauth",
    available: false,
    soon: true,
  },
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
