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
//  Everything else — Cloudinary, Google Drive, etc. — is entered
//  by each user INSIDE the website and stored privately in their
//  own browser (localStorage). None of that belongs here.
// ============================================================

export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  appId: "PASTE_YOUR_APP_ID",
};

// Internal: usernames are stored as emails so Firebase Auth can use
// them. You normally never need to change this.
export const USERNAME_EMAIL_DOMAIN = "vaultmall.app";

export function isConfigured() {
  return !firebaseConfig.apiKey.startsWith("PASTE_");
}
