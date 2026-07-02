// ============================================================
//  Vaultmall — Albums (per-user, in the browser)
//  An album is just a named, ordered set of item ids. Like every
//  other personal thing in Vaultmall, albums live in the user's
//  own browser, namespaced by their login.
// ============================================================

const KEY = (uid) => `vaultmall:albums:${uid}`;

export function loadAlbums(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist(uid, albums) {
  localStorage.setItem(KEY(uid), JSON.stringify(albums));
  return albums;
}

export function createAlbum(uid, name) {
  const albums = loadAlbums(uid);
  const album = {
    id: "al_" + Math.random().toString(36).slice(2, 9),
    name: String(name).trim() || "Untitled",
    itemIds: [],
    createdAt: Date.now(),
  };
  albums.push(album);
  persist(uid, albums);
  return album;
}

export function renameAlbum(uid, albumId, name) {
  const albums = loadAlbums(uid);
  const a = albums.find((x) => x.id === albumId);
  if (a) a.name = String(name).trim() || a.name;
  return persist(uid, albums);
}

export function deleteAlbum(uid, albumId) {
  return persist(uid, loadAlbums(uid).filter((a) => a.id !== albumId));
}

export function addToAlbum(uid, albumId, itemIds) {
  const albums = loadAlbums(uid);
  const a = albums.find((x) => x.id === albumId);
  if (a) {
    for (const id of itemIds) if (!a.itemIds.includes(id)) a.itemIds.push(id);
  }
  persist(uid, albums);
  return a;
}

export function removeFromAlbum(uid, albumId, itemIds) {
  const albums = loadAlbums(uid);
  const a = albums.find((x) => x.id === albumId);
  if (a) a.itemIds = a.itemIds.filter((id) => !itemIds.includes(id));
  return persist(uid, albums);
}
