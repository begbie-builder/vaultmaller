// ============================================================
//  Vaultmall — brand marks
//  Monochrome official-style glyphs rendered white on solid
//  brand-color blocks. One drawing style, one sizing box, so
//  every service reads as part of the same designed system.
// ============================================================

const GLYPHS = {
  // Google Drive — the triangular ring
  gdrive: `<path fill-rule="evenodd" d="M8.2 2h7.6L24 16.2 20.2 22H3.8L0 16.2 8.2 2zm3.8 5.1L5.6 18h12.8L12 7.1z"/>`,
  // Dropbox — the four diamonds + base
  dropbox: `<path d="M6 1.8L0 5.6l6 3.8 6-3.8-6-3.8zm12 0l-6 3.8 6 3.8 6-3.8-6-3.8zM0 13.3l6 3.8 6-3.8-6-3.8-6 3.8zm18-3.8l-6 3.8 6 3.8 6-3.8-6-3.8zM6 18.4l6 3.8 6-3.8-6-3.8-6 3.8z"/>`,
  // MEGA — circle M
  mega: `<path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm5.9 16.4c0 .3-.2.5-.5.5h-1.5c-.3 0-.5-.2-.5-.5v-4.7l-2.8 2.8c-.3.3-.9.3-1.2 0l-2.8-2.8v4.7c0 .3-.2.5-.5.5H6.6c-.3 0-.5-.2-.5-.5V7.6c0-.3.2-.5.5-.5h1.1c.2 0 .4.1.5.2l3.8 3.8 3.8-3.8c.1-.1.3-.2.5-.2h1.1c.3 0 .5.2.5.5v8.8z"/>`,
  // Cloudinary — cloud
  cloudinary: `<path d="M19.2 10.1A7.2 7.2 0 0 0 5.5 8.6 5.4 5.4 0 0 0 6 19.4h12.6a4.7 4.7 0 0 0 .6-9.3zm-.6 7.5H6a3.6 3.6 0 0 1-.3-7.2l1.1-.1.3-1a5.4 5.4 0 0 1 10.5 1l.2 1.3 1.3.1a2.9 2.9 0 0 1-.5 5.9z"/>`,
  // Local — display
  local: `<path d="M2 3h20v13H2V3zm2 2v9h16V5H4zm4 13h8l1 3H7l1-3z"/>`,
  // OneDrive — double cloud
  onedrive: `<path d="M14.5 6a6 6 0 0 1 5.9 5 4.5 4.5 0 0 1-.9 8.9H7a5 5 0 0 1-1.4-9.8A6 6 0 0 1 14.5 6zm0 2a4 4 0 0 0-3.9 3.1l-.3 1.2-1.2.2A3 3 0 0 0 7 18h12.5a2.5 2.5 0 0 0 .4-5l-1.5-.2-.2-1.5A4 4 0 0 0 14.5 8z"/>`,
  // S3 / R2 — bucket
  s3: `<path d="M5 2h14l-1 5H6L5 2zm1.3 7h11.4l-1.6 13H7.9L6.3 9zm3 2l.8 9h3.8l.8-9H9.3z"/>`,
  // Direct links — chain
  url: `<path d="M10.6 13.4a1 1 0 0 0 1.4 0l4.2-4.2a3 3 0 0 0-4.2-4.3L9.9 7a1 1 0 1 0 1.4 1.4l2.1-2.1a1 1 0 0 1 1.4 1.4l-4.2 4.3a1 1 0 0 0 0 1.4zm2.8-2.8a1 1 0 0 0-1.4 0l-4.2 4.2a3 3 0 1 0 4.2 4.3l2.1-2.1a1 1 0 1 0-1.4-1.4l-2.1 2.1a1 1 0 0 1-1.4-1.4l4.2-4.3a1 1 0 0 0 0-1.4z"/>`,
};

export const BRAND = {
  gdrive: { color: "#2684FC", name: "Google Drive" },
  dropbox: { color: "#0061FF", name: "Dropbox" },
  mega: { color: "#D9272E", name: "MEGA" },
  cloudinary: { color: "#3448C5", name: "Cloudinary" },
  local: { color: "#E8490F", name: "Local Files" },
  onedrive: { color: "#0078D4", name: "OneDrive" },
  s3: { color: "#FF9900", name: "S3 / R2" },
  url: { color: "#0F9D8F", name: "Direct Links" },
};

// A solid brand block with the white glyph centred in it.
export function logoBlock(id, size = 44) {
  const b = BRAND[id] || { color: "#111111" };
  const glyph = GLYPHS[id] || GLYPHS.url;
  return `<span class="brandblock" style="--bb:${b.color};width:${size}px;height:${size}px">
    <svg viewBox="0 0 24 24" width="${Math.round(size * 0.5)}" height="${Math.round(size * 0.5)}" fill="#FFFFFF" aria-hidden="true">${glyph}</svg>
  </span>`;
}

export function glyphSvg(id, px = 14, fill = "currentColor") {
  const glyph = GLYPHS[id] || GLYPHS.url;
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="${fill}" aria-hidden="true">${glyph}</svg>`;
}
