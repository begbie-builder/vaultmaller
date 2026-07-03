// ============================================================
//  EBML primitives + a streaming window over a random-access
//  byte source. Matroska (MKV/WebM) is EBML: every element is
//  [vint id][vint size][payload]. We parse it incrementally so
//  a 40GB file never occupies more than a few MB of memory.
// ============================================================

// How many leading bits before the first 1 → total byte length.
function vintLength(firstByte) {
  if (firstByte === 0) return -1; // invalid / need more data
  for (let len = 1; len <= 8; len++) {
    if (firstByte & (0x100 >> len)) return len;
  }
  return -1;
}

export class EOFError extends Error {}

// A forward-reading cursor over `source` (an object with
// `read(offset, length) -> Uint8Array|null` and `size`), pulling
// CHUNK-sized ranges on demand. `pos` is the absolute file offset.
export class EbmlStream {
  constructor(source, offset = 0, chunkSize = 4 << 20) {
    this.source = source;
    this.pos = offset;
    this.chunk = chunkSize;
    this.buf = new Uint8Array(0);
    this.bufStart = offset; // absolute offset of buf[0]
    this.eof = false;
  }

  get available() { return this.bufStart + this.buf.length - this.pos; }

  async ensure(n) {
    while (this.available < n && !this.eof) {
      const fetchAt = this.bufStart + this.buf.length;
      const want = Math.max(n - this.available, this.chunk);
      const got = await this.source.read(fetchAt, want);
      if (!got || got.length === 0) { this.eof = true; break; }
      // Drop consumed bytes before growing the window.
      const keepFrom = this.pos - this.bufStart;
      const merged = new Uint8Array(this.buf.length - keepFrom + got.length);
      merged.set(this.buf.subarray(keepFrom), 0);
      merged.set(got, this.buf.length - keepFrom);
      this.bufStart = this.pos;
      this.buf = merged;
      if (got.length < want) this.eof = true;
    }
    if (this.available < n) throw new EOFError(`need ${n} bytes at ${this.pos}`);
  }

  byteAt(absPos) { return this.buf[absPos - this.bufStart]; }

  async readBytes(n) {
    await this.ensure(n);
    const off = this.pos - this.bufStart;
    const out = this.buf.subarray(off, off + n);
    this.pos += n;
    return out;
  }

  async skip(n) { this.pos += n; } // ranges are cheap; just move the cursor
  seek(absPos) { this.pos = absPos; this.buf = new Uint8Array(0); this.bufStart = absPos; this.eof = false; }

  // Element ID: keep the marker bit (IDs are matched with it included).
  async readId() {
    await this.ensure(1);
    const len = vintLength(this.byteAt(this.pos));
    if (len < 0 || len > 4) throw new Error(`bad EBML id at ${this.pos}`);
    await this.ensure(len);
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + this.byteAt(this.pos + i);
    this.pos += len;
    return v;
  }

  // Peek the next element ID without consuming it (for unknown-size
  // containers that end when a non-child appears).
  async peekId() {
    await this.ensure(1);
    const len = vintLength(this.byteAt(this.pos));
    if (len < 0 || len > 4) return -1;
    await this.ensure(len);
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + this.byteAt(this.pos + i);
    return v;
  }

  // Element size: strip the marker; all-ones payload means "unknown".
  async readSize() {
    await this.ensure(1);
    const first = this.byteAt(this.pos);
    const len = vintLength(first);
    if (len < 0) throw new Error(`bad EBML size at ${this.pos}`);
    await this.ensure(len);
    let v = first & ((0x100 >> len) - 1);
    let allOnes = v === (0x100 >> len) - 1;
    for (let i = 1; i < len; i++) {
      const b = this.byteAt(this.pos + i);
      v = v * 256 + b;
      if (b !== 0xff) allOnes = false;
    }
    this.pos += len;
    return allOnes ? -1 : v; // -1 = unknown size (streamed Segment/Cluster)
  }
}

// ---- payload decoders (operate on already-read Uint8Arrays) ----
export function ebmlUint(bytes) {
  let v = 0;
  for (const b of bytes) v = v * 256 + b;
  return v;
}
export function ebmlFloat(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length === 4) return dv.getFloat32(0);
  if (bytes.length === 8) return dv.getFloat64(0);
  return 0;
}
export function ebmlString(bytes) {
  return new TextDecoder().decode(bytes);
}

// Signed vint inside block payloads (track numbers, lace deltas).
export function readVintFrom(bytes, at) {
  const len = vintLength(bytes[at]);
  if (len < 0) throw new Error("bad vint in block");
  let v = bytes[at] & ((0x100 >> len) - 1);
  for (let i = 1; i < len; i++) v = v * 256 + bytes[at + i];
  return { value: v, length: len };
}
export function readSignedVintFrom(bytes, at) {
  const { value, length } = readVintFrom(bytes, at);
  const bias = Math.pow(2, 7 * length - 1) - 1;
  return { value: value - bias, length };
}
