// ============================================================
//  Vaultmall — Firebase configuration (the app's LOGIN backend)
// ============================================================
//  This is the ONLY thing that lives in code, and it is NOT a
//  per-user secret. It just points Vaultmall at the one Firebase
//  project that handles username/password logins. It is safe to
//  commit to a public repo — it only identifies the project.
//
//  👉 STEP 1 of the README: replace every "PASTE_..." value below
//     with the values from YOUR Firebase console.
//
//  Everything else (Cloudinary, Google Drive, etc.) is entered
//  by each user INSIDE the website and synced to their private
//  Firebase document, so it follows them across devices.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDhfPhyts853CC3AKtjeq5avvKoYJtqpH0",
  authDomain: "vaultmaller.firebaseapp.com",
  projectId: "vaultmaller",
  appId: "1:848268514047:web:2a31d0be8312d109fe72ca",
};

// Optional: one-click Dropbox. Create ONE Dropbox app for your site
// (README, "More distributors → Dropbox") and paste its App key here.
// This is a public identifier like the Firebase keys above, not a
// secret. Users then connect with a single click; no tokens, no apps.
export const dropboxConfig = {
  appKey: "7g8ysa9b3txsmh6",
};

export function isDropboxConfigured() {
  return !dropboxConfig.appKey.startsWith("PASTE_");
}

// Internal: usernames are stored as emails so Firebase Auth can use
// them. You normally never need to change this.
export const USERNAME_EMAIL_DOMAIN = "vaultmall.app";

export function isConfigured() {
  return !firebaseConfig.apiKey.startsWith("PASTE_");
}
