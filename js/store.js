// ============================================================
//  Vaultmall — per-user credential store (localStorage)
//  Every storage service a user connects is saved ONLY in their
//  own browser, namespaced by their user id. Nothing here ever
//  travels to a server — it stays on their device, private to
//  their login. Clearing browser data clears it.
// ============================================================

const KEY = (uid) => `vaultmall:connections:${uid}`;

// Returns { providerId: config, ... } for this user (or {}).
export function loadConnections(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveConnection(uid, providerId, config) {
  const all = loadConnections(uid);
  all[providerId] = { ...config, updatedAt: Date.now() };
  localStorage.setItem(KEY(uid), JSON.stringify(all));
}

export function removeConnection(uid, providerId) {
  const all = loadConnections(uid);
  delete all[providerId];
  localStorage.setItem(KEY(uid), JSON.stringify(all));
}
