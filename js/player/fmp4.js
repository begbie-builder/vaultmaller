// ============================================================
//  Fragmented-MP4 muxer. Builds an init segment (ftyp+moov) and
//  moof/mdat fragments from raw samples. MKV conveniently stores
//  AVC/HEVC as length-prefixed NAL units with avcC/hvcC in
//  CodecPrivate, so video samples copy straight into mdat —
//  container surgery only, no bitstream rewriting.
// ============================================================

// ---- byte plumbing ----
const te = new TextEncoder();
function u8(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function u16(v) { return new Uint8Array([v >> 8, v & 0xff]); }
function u32(v) { return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]); }
function u64(v) { return u8(u32(Math.floor(v / 4294967296)), u32(v >>> 0)); }
function i16(v) { return u16(v < 0 ? v + 0x10000 : v); }
function box(type, ...parts) {
  const body = u8(...parts);
  return u8(u32(body.length + 8), te.encode(type), body);
}
function full(type, version, flags, ...parts) {
  return box(type, new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts);
}

// ---- codec strings (RFC 6381) ----
export function avcCodecString(avcC) {
  // avcC[1..3] = profile_idc, profile_compatibility, level_idc
  const hex = (b) => b.toString(16).padStart(2, "0").toUpperCase();
  return `avc1.${hex(avcC[1])}${hex(avcC[2])}${hex(avcC[3])}`;
}

export function hevcCodecString(hvcC) {
  const b1 = hvcC[1];
  const space = (b1 >> 6) & 0x3;
  const tier = (b1 >> 5) & 0x1;
  const profileIdc = b1 & 0x1f;
  // compatibility flags: 32 bits, bit-reversed in the codec string
  const compat = ((hvcC[2] << 24) | (hvcC[3] << 16) | (hvcC[4] << 8) | hvcC[5]) >>> 0;
  let rev = 0;
  for (let i = 0; i < 32; i++) rev = ((rev << 1) | ((compat >>> i) & 1)) >>> 0;
  const levelIdc = hvcC[12];
  let s = "hvc1." + (space ? "ABC"[space - 1] : "") + profileIdc +
    "." + rev.toString(16).toUpperCase() +
    "." + (tier ? "H" : "L") + levelIdc;
  // constraint bytes 6..11, trailing zero bytes omitted
  let last = 5;
  for (let i = 11; i >= 6; i--) { if (hvcC[i]) { last = i; break; } }
  for (let i = 6; i <= last; i++) s += "." + hvcC[i].toString(16).toUpperCase();
  return s;
}

export function vp9CodecString() {
  // Advisory for MSE type checks; the bitstream is authoritative.
  return "vp09.00.10.08"; // profile 0, level 1.0, 8-bit
}

export function aacCodecString(asc) {
  const objectType = asc && asc.length ? (asc[0] >> 3) : 2;
  return `mp4a.40.${objectType || 2}`;
}

// ---- sample entries ----
function visualSampleEntryHeader(width, height) {
  return u8(
    new Uint8Array(6), u16(1),            // reserved, data_reference_index
    u16(0), u16(0), u32(0), u32(0), u32(0), // pre_defined/reserved
    u16(width), u16(height),
    u32(0x00480000), u32(0x00480000),     // 72 dpi
    u32(0), u16(1),                       // reserved, frame_count
    new Uint8Array(32),                   // compressorname
    u16(0x0018), i16(-1)                  // depth, pre_defined
  );
}

function audioSampleEntryHeader(channels, sampleRate) {
  return u8(
    new Uint8Array(6), u16(1),
    u32(0), u32(0),
    u16(channels), u16(16), u16(0), u16(0),
    u32(sampleRate << 16)
  );
}

function esds(asc) {
  const ascLen = asc.length;
  const dcd = u8( // DecoderConfigDescriptor (tag 4)
    new Uint8Array([0x04, 0x80, 0x80, 0x80, 13 + 5 + ascLen,
      0x40, 0x15, 0x00, 0x00, 0x00]),   // objectType AAC, streamType audio
    u32(0), u32(0),                      // maxBitrate, avgBitrate (0 = unknown)
    new Uint8Array([0x05, 0x80, 0x80, 0x80, ascLen]), asc // DecoderSpecificInfo
  );
  const esd = u8( // ES_Descriptor (tag 3)
    new Uint8Array([0x03, 0x80, 0x80, 0x80, 3 + dcd.length + 3]),
    u16(1), new Uint8Array([0]),         // ES_ID, flags
    dcd,
    new Uint8Array([0x06, 0x80, 0x80, 0x80, 1, 0x02]) // SLConfig
  );
  return full("esds", 0, 0, esd);
}

export function sampleEntryFor(track) {
  if (track.codec === "avc") {
    return box("avc1", visualSampleEntryHeader(track.width, track.height), box("avcC", track.codecPrivate));
  }
  if (track.codec === "hevc") {
    return box("hvc1", visualSampleEntryHeader(track.width, track.height), box("hvcC", track.codecPrivate));
  }
  if (track.codec === "vp9") {
    // vpcC: VP Codec Configuration (version 1). MKV VP9 rarely carries
    // CodecPrivate, so we write sane defaults; decoders trust the stream.
    const vpcC = full("vpcC", 1, 0, new Uint8Array([
      0,          // profile
      10,         // level 1.0
      (8 << 4) | (1 << 1) | 0, // bitDepth=8, chroma=4:2:0 colocated, full-range=0
      1, 1, 1,    // BT.709 primaries/transfer/matrix
    ]), u16(0));  // codecInitializationDataSize
    return box("vp09", visualSampleEntryHeader(track.width, track.height), vpcC);
  }
  if (track.codec === "aac") {
    return box("mp4a", audioSampleEntryHeader(track.channels || 2, track.sampleRate || 48000), esds(track.codecPrivate));
  }
  throw new Error(`no sample entry for codec ${track.codec}`);
}

// ---- init segment ----
export function initSegment(track) {
  const ftyp = box("ftyp", te.encode("isom"), u32(0x200), te.encode("isomiso5iso6mp41"));

  const mvhd = full("mvhd", 0, 0,
    u32(0), u32(0), u32(track.timescale), u32(0),  // times, duration 0 (live-style)
    u32(0x00010000), u16(0x0100), u16(0),
    u32(0), u32(0),
    u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000),
    new Uint8Array(24), u32(0xffffffff)             // pre_defined, next_track_ID
  );

  const isVideo = track.isVideo !== undefined ? !!track.isVideo : track.codec !== "aac";
  const tkhd = full("tkhd", 0, 7,
    u32(0), u32(0), u32(track.id), u32(0), u32(0),
    u32(0), u32(0), u16(0), u16(isVideo ? 0 : 1), u16(0), u16(0),
    u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000),
    u32((track.width || 0) << 16), u32((track.height || 0) << 16)
  );

  const mdhd = full("mdhd", 0, 0, u32(0), u32(0), u32(track.timescale), u32(0), u16(0x55c4), u16(0)); // 'und'
  const hdlr = full("hdlr", 0, 0, u32(0), te.encode(isVideo ? "vide" : "soun"), u32(0), u32(0), u32(0), te.encode("Vaultmall\0"));
  const header = isVideo ? full("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0)) : full("smhd", 0, 0, u16(0), u16(0));
  const dinf = box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
  const stbl = box("stbl",
    full("stsd", 0, 0, u32(1), sampleEntryFor(track)),
    full("stts", 0, 0, u32(0)),
    full("stsc", 0, 0, u32(0)),
    full("stsz", 0, 0, u32(0), u32(0)),
    full("stco", 0, 0, u32(0))
  );
  const minf = box("minf", header, dinf, stbl);
  const mdia = box("mdia", mdhd, hdlr, minf);
  const trak = box("trak", tkhd, mdia);
  const trex = full("trex", 0, 0, u32(track.id), u32(1), u32(0), u32(0), u32(0));
  const moov = box("moov", mvhd, trak, box("mvex", trex));
  return u8(ftyp, moov);
}

// ---- media fragment ----
// samples: [{ data, duration, cts, sync }] — durations/cts in track ticks.
const FLAG_SYNC = 0x02000000;
const FLAG_NON_SYNC = 0x01010000;

export function fragment(track, sequence, baseDecodeTime, samples) {
  const trunRows = [];
  let mdatSize = 0;
  for (const s of samples) {
    trunRows.push(u32(s.duration), u32(s.data.length), u32(s.sync ? FLAG_SYNC : FLAG_NON_SYNC), u32(s.cts < 0 ? s.cts + 0x100000000 : s.cts));
    mdatSize += s.data.length;
  }
  const trunFlags = 0x000001 | 0x000100 | 0x000200 | 0x000400 | 0x000800; // offset|dur|size|flags|cts
  // data_offset patched after moof size known — build with placeholder.
  const trunBody = u8(u32(samples.length), u32(0 /* patched */), ...trunRows);
  const trun = full("trun", 1, trunFlags, trunBody);
  const tfhd = full("tfhd", 0, 0x020000, u32(track.id)); // default-base-is-moof
  const tfdt = full("tfdt", 1, 0, u64(baseDecodeTime));
  const traf = box("traf", tfhd, tfdt, trun);
  const mfhd = full("mfhd", 0, 0, u32(sequence));
  const moof = box("moof", mfhd, traf);
  // Patch trun data_offset: first mdat payload byte, relative to moof start.
  // trunBody sits at the very end of moof: [sample_count u32][data_offset u32][rows].
  const dataOffset = moof.length + 8;
  const trunOffsetAt = moof.length - trunBody.length + 4; // skip sample_count
  const dv = new DataView(moof.buffer, moof.byteOffset);
  dv.setUint32(trunOffsetAt, dataOffset);

  const mdat = new Uint8Array(8 + mdatSize);
  new DataView(mdat.buffer).setUint32(0, mdat.length);
  mdat.set(te.encode("mdat"), 4);
  let at = 8;
  for (const s of samples) { mdat.set(s.data, at); at += s.data.length; }
  return u8(moof, mdat);
}
