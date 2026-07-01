// ============================================================
//  Vaultmall — Firebase bootstrap (Auth + Firestore)
//  Uses the modular SDK straight from the CDN. No build step.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig, USERNAME_EMAIL_DOMAIN, isConfigured } from "./firebase-config.js";

let auth = null;
let db = null;

export function initFirebase() {
  if (!isConfigured()) {
    throw new Error(
      "Firebase isn't configured yet. Open js/firebase-config.js and paste your keys (see the README, Step 1)."
    );
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  return { auth, db };
}

// Firebase Auth wants an email. We turn a username into a stable,
// private email so the user only ever types a username + password.
function usernameToEmail(username) {
  const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${clean}@${USERNAME_EMAIL_DOMAIN}`;
}

export async function signUp(username, password) {
  const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
  // Seed the user's private profile document.
  await setDoc(doc(db, "users", cred.user.uid), {
    username: String(username).trim(),
    createdAt: serverTimestamp(),
    connections: {},
  });
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

// ---- Per-user connection config (stored privately in Firestore) ----

export async function loadProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return { username: "user", connections: {} };
  return snap.data();
}

export async function saveConnection(uid, providerId, config) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, { [`connections.${providerId}`]: { ...config, updatedAt: Date.now() } });
}

export async function removeConnection(uid, providerId) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, { [`connections.${providerId}`]: deleteField() });
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
