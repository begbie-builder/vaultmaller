// ============================================================
//  Vaultmall — Films engine
//  Jellyfin-style heuristics: scrub a messy filename down to a
//  probable title + year, look it up on TMDb, and remember the
//  match. Users can always override via the match modal.
//  TMDb / OMDb keys are the user's own and live in their browser.
// ============================================================

const JUNK = new Set([
  "1080p","720p","2160p","480p","4k","uhd","hdr","hdr10","dv","dolby","vision",
  "bluray","blu-ray","bdrip","brrip","webrip","web-dl","webdl","web","hdtv","dvdrip",
  "x264","x265","h264","h265","hevc","avc","av1","aac","ac3","dts","atmos","truehd",
  "remux","proper","repack","extended","unrated","directors","cut","imax","remastered",
  "multi","dual","subbed","dubbed","sub","10bit","8bit","hq","cam","ts","internal",
]);

const VIDEO_HINT = /\.(mkv|mp4|avi|m4v|mov|webm|ts|ogv)$/i;

// ---- Filename → { title, year, season, episode, isSeries } ----
export function parseName(raw) {
  let s = String(raw).replace(VIDEO_HINT, "");
  s = s.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();

  let season = null, episode = null;
  const se = s.match(/\bS(\d{1,2})\s?E(\d{1,3})\b/i);
  if (se) { season = +se[1]; episode = +se[2]; s = s.slice(0, se.index); }

  let year = null;
  // Prefer a (2019)-style year; else the last bare year that isn't at position 0.
  const paren = s.match(/\((19|20)\d{2}\)/);
  if (paren) { year = +paren[0].slice(1, 5); s = s.slice(0, paren.index); }
  else {
    const years = [...s.matchAll(/\b(19|20)\d{2}\b/g)];
    const pick = years.reverse().find((m) => m.index > 0);
    if (pick) { year = +pick[0]; s = s.slice(0, pick.index); }
  }

  // Cut at the first junk token — everything after is release noise.
  const words = s.split(" ");
  const keep = [];
  for (const w of words) {
    const t = w.toLowerCase().replace(/[\[\]()-]/g, "");
    if (JUNK.has(t)) break;
    if (t) keep.push(w.replace(/[\[\]]/g, ""));
  }
  const title = keep.join(" ").replace(/[-–]\s*$/, "").trim();

  return { title, year, season, episode, isSeries: season != null };
}

// A video looks like a film/episode if the name carries a year or SxxExx,
// or it's an mkv (rarely used for casual clips).
export function looksLikeFilm(item) {
  if (item.type !== "video") return false;
  const p = parseName(item.title);
  if (p.isSeries || p.year) return true;
  return /\.mkv$/i.test(item.title);
}

// ---- TMDb ----
const TMDB = "https://api.themoviedb.org/3";
export const posterUrl = (path, w = 342) => (path ? `https://image.tmdb.org/t/p/w${w}${path}` : "");
export const backdropUrl = (path) => (path ? `https://image.tmdb.org/t/p/w1280${path}` : "");

async function tmdb(key, path, params = {}) {
  const q = new URLSearchParams({ api_key: key, ...params });
  const res = await fetch(`${TMDB}${path}?${q}`);
  if (res.status === 401) throw new Error("TMDb rejected your API key.");
  if (!res.ok) throw new Error(`TMDb error ${res.status}.`);
  return res.json();
}

export async function searchTitles(key, query, year) {
  const params = { query, include_adult: "false" };
  const data = await tmdb(key, "/search/multi", params);
  return (data.results || [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((r) => ({
      tmdbId: r.id,
      kind: r.media_type,
      title: r.title || r.name || "Untitled",
      year: ((r.release_date || r.first_air_date || "").slice(0, 4)) || "",
      poster: r.poster_path,
      backdrop: r.backdrop_path,
      vote: r.vote_average || 0,
      overview: r.overview || "",
    }))
    .sort((a, b) => {
      // Year agreement first, then TMDb's own ordering.
      const ay = year && +a.year === +year ? 1 : 0;
      const by = year && +b.year === +year ? 1 : 0;
      return by - ay;
    });
}

export async function titleDetails(key, kind, id) {
  const data = await tmdb(key, `/${kind}/${id}`, { append_to_response: "credits,external_ids" });
  return {
    tmdbId: id,
    kind,
    title: data.title || data.name || "Untitled",
    year: ((data.release_date || data.first_air_date || "").slice(0, 4)) || "",
    poster: data.poster_path,
    backdrop: data.backdrop_path,
    vote: data.vote_average || 0,
    genres: (data.genres || []).map((g) => g.name),
    runtime: data.runtime || (data.episode_run_time || [])[0] || 0,
    overview: data.overview || "",
    imdbId: (data.external_ids || {}).imdb_id || "",
    cast: ((data.credits || {}).cast || []).slice(0, 8).map((c) => c.name),
  };
}

// ---- OMDb (optional — fills IMDb rating + Rotten Tomatoes) ----
export async function omdbScores(omdbKey, imdbId) {
  if (!omdbKey || !imdbId) return {};
  const res = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbKey)}&i=${imdbId}`);
  if (!res.ok) return {};
  const d = await res.json();
  const rt = (d.Ratings || []).find((r) => r.Source === "Rotten Tomatoes");
  return {
    imdb: d.imdbRating && d.imdbRating !== "N/A" ? d.imdbRating : "",
    rt: rt ? rt.Value : "",
  };
}

// ---- Per-user films store (matches + overrides), in the browser ----
const KEY = (uid) => `vaultmall:films:${uid}`;

export function loadFilmStore(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid));
    const d = raw ? JSON.parse(raw) : {};
    return { matches: d.matches || {}, include: d.include || [], exclude: d.exclude || [] };
  } catch {
    return { matches: {}, include: [], exclude: [] };
  }
}

export function saveFilmStore(uid, storeObj) {
  localStorage.setItem(KEY(uid), JSON.stringify(storeObj));
}
