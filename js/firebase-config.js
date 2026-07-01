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
  apiKey: "AIzaSyD...realkey...",
  authDomain: "vaultmall-1234.firebaseapp.com",
  projectId: "vaultmall-1234",
  storageBucket: "vaultmall-1234.appspot.com",
  messagingSenderId: "839201...",
  appId: "1:839201...:web:abc123...",
};
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
