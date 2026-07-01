// ============================================================
//  Vaultmall — Firebase configuration
// ============================================================
//  👉 STEP 1 of the README asks you to paste your own Firebase
//     project keys here. Replace every "PASTE_..." value below
//     with the values from your Firebase console.
//
//  These keys are SAFE to commit to a public repo. They only
//  identify your project. Real security comes from the Firestore
//  security rules (see firestore.rules) — NOT from hiding these.
// ============================================================

export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID",
};

// Optional: Google Drive support. Paste your OAuth Client ID here
// (README explains where to get it). Leave as-is to hide Drive.
export const googleConfig = {
  clientId: "PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
};

// Internal: usernames are stored as emails so Firebase Auth can use
// them. You normally never need to change this.
export const USERNAME_EMAIL_DOMAIN = "vaultmall.app";

export function isConfigured() {
  return !firebaseConfig.apiKey.startsWith("PASTE_");
}

export function isGoogleConfigured() {
  return !googleConfig.clientId.startsWith("PASTE_");
}
