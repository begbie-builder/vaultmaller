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

// ---- TV detection ----
// A file is an episode when the filename says SxxExx, OR when it lives
// in a folder that looks like a season ("…/Show Name/Season 2/ep.mkv",
// "…/Show Name/S02/…"). The show's name is the folder above the season
// folder — exactly how Jellyfin libraries are laid out.
const SEASON_DIR = /^(season[ ._-]*(\d{1,2})|s(\d{1,2}))$/i;

export function classify(item) {
  const p = parseName(item.title);
  const segs = String(item.sub || "").split("/").map((s) => s.trim()).filter(Boolean);

  let season = p.season;
  let episode = p.episode;
  let seriesTitle = null;

  const si = segs.findIndex((s) => SEASON_DIR.test(s));
  if (si >= 0) {
    const m = segs[si].match(SEASON_DIR);
    const n = m[2] || m[3];
    if (season == null && n) season = +n;
    if (si > 0) seriesTitle = segs[si - 1];
  }

  if (p.isSeries || season != null) {
    if (!seriesTitle) seriesTitle = p.title || (si > 0 ? segs[si - 1] : segs[segs.length - 1]) || "";
    if (episode == null) {
      // "03 - Pilot.mkv" / "Episode 3" style fallbacks
      const m = item.title.match(/\b(?:e|ep|episode)[ ._-]*(\d{1,3})\b/i) || item.title.match(/^(\d{1,3})\b/);
      if (m) episode = +m[1];
    }
    seriesTitle = seriesTitle.replace(/[._]+/g, " ").trim();
    if (seriesTitle) {
      return {
        kind: "episode",
        seriesKey: "series:" + seriesTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        seriesTitle,
        season: season != null ? season : 1,
        episode: episode != null ? episode : 0,
        year: p.year,
      };
    }
  }
  return { kind: "movie", title: p.title, year: p.year };
}

// A video belongs in Films if it's an episode, carries a year,
// or is an mkv (rarely used for casual clips).
export function looksLikeFilm(item) {
  if (item.type !== "video") return false;
  const c = classify(item);
  if (c.kind === "episode") return true;
  const p = parseName(item.title);
  if (p.year) return true;
  return /\.mkv$/i.test(item.title);
}

// ---- TMDb ----
const TMDB = "https://api.themoviedb.org/3";
export const posterUrl = (path, w = 342) => (path ? `https://image.tmdb.org/t/p/w${w}${path}` : "");
export const backdropUrl = (path, size = "w1280") => (path ? `https://image.tmdb.org/t/p/${size}${path}` : "");
export const logoUrl = (path) => (path ? `https://image.tmdb.org/t/p/w500${path}` : "");
export const profileUrl = (path) => (path ? `https://image.tmdb.org/t/p/w185${path}` : "");

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
  const data = await tmdb(key, `/${kind}/${id}`, {
    append_to_response: "credits,external_ids,images",
    include_image_language: "en,null",
  });
  const logos = ((data.images || {}).logos || []);
  return {
    tmdbId: id,
    kind,
    title: data.title || data.name || "Untitled",
    year: ((data.release_date || data.first_air_date || "").slice(0, 4)) || "",
    poster: data.poster_path,
    backdrop: data.backdrop_path,
    logo: logos.length ? logos[0].file_path : "",
    vote: data.vote_average || 0,
    genres: (data.genres || []).map((g) => g.name),
    runtime: data.runtime || (data.episode_run_time || [])[0] || 0,
    overview: data.overview || "",
    imdbId: (data.external_ids || {}).imdb_id || "",
    cast: ((data.credits || {}).cast || []).slice(0, 12).map((c) => ({
      name: c.name,
      role: c.character || "",
      img: c.profile_path || "",
    })),
    rich: true, // has logo + cast photos (older matches get re-fetched lazily)
  };
}

// ---- OMDb (optional — fills IMDb rating + Rotten Tomatoes) ----
export async function omdbScores(omdbKey, imdbId) {
  if (!omdbKey || !imdbId) return {};
  const res = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbKey)}&i=${imdbId}`);
  const d = await res.json().catch(() => ({}));
  // A bad or not-yet-activated key answers 401 with an Error field.
  if (d.Error && /api key/i.test(d.Error)) {
    throw new Error("OMDb rejected the key. Check it in Settings, and make sure you clicked the activation link OMDb emailed you.");
  }
  if (!res.ok || d.Response === "False") return {};
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
