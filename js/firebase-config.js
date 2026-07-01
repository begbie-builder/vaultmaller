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
  apiKey: "AIzaSyDhfPhyts853CC3AKtjeq5avvKoYJtqpH0",
  authDomain: "vaultmaller.firebaseapp.com",
  projectId: "vaultmaller",
  appId: "1:848268514047:web:2a31d0be8312d109fe72ca",
};

// Internal: usernames are stored as emails so Firebase Auth can use
// them. You normally never need to change this.
export const USERNAME_EMAIL_DOMAIN = "vaultmall.app";

export function isConfigured() {
  return !firebaseConfig.apiKey.startsWith("PASTE_");
}
