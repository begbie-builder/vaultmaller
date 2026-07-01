// ============================================================
//  Vaultmall — Firebase bootstrap (Auth only)
//  We use Firebase ONLY for username/password logins. There is
//  no database here: each user's connected storage services are
//  saved in their own browser (see store.js). Loaded straight
//  from the CDN — no build step.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig, USERNAME_EMAIL_DOMAIN, isConfigured } from "./firebase-config.js";

let auth = null;

export function initFirebase() {
  if (!isConfigured()) {
    throw new Error(
      "Firebase isn't configured yet. Open js/firebase-config.js and paste your keys (see the README, Step 1)."
    );
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  return { auth };
}

// Firebase Auth wants an email. We turn a username into a stable,
// private email so the user only ever types a username + password.
function usernameToEmail(username) {
  const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${clean}@${USERNAME_EMAIL_DOMAIN}`;
}

// Recover the display username from the account email.
export function usernameOf(user) {
  if (!user || !user.email) return "user";
  return user.email.split("@")[0];
}

export async function signUp(username, password) {
  const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
  return cred.user;
}

export async function logIn(username, password) {
  const cred = await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
  return cred.user;
}

export async function logOut() {
  await signOut(auth);
}

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export function friendlyAuthError(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/invalid-credential": "Wrong username or password.",
    "auth/wrong-password": "Wrong username or password.",
    "auth/user-not-found": "No account with that username. Try creating one.",
    "auth/email-already-in-use": "That username is taken. Pick another.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/network-request-failed": "Network problem. Check your connection.",
  };
  return map[code] || (err && err.message) || "Something went wrong.";
}
