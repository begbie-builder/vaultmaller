// ============================================================
//  Matroska demuxer (streaming, random-access).
//  Reads Tracks/Info/Cues from the head via SeekHead, then walks
//  Clusters emitting samples in decode order with nanosecond
//  presentation timestamps. Handles SimpleBlock + BlockGroup and
//  every lacing mode (none / Xiph / EBML / fixed).
// ============================================================
import { EbmlStream, EOFError, ebmlUint, ebmlFloat, ebmlString, readVintFrom, readSignedVintFrom } from "./ebml.js";

// Element IDs
const ID = {
  EBMLHeader: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  DefaultDuration: 0x23e383,
  FlagDefault: 0x88,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  ClusterTimestamp: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Chapters: 0x1043a770,
  Tags: 0x1254c367,
  Attachments: 0x1941a469,
};

// Elements that terminate an unknown-size Cluster.
const TOP_LEVEL = new Set([ID.Cluster, ID.Cues, ID.Tracks, ID.Info, ID.SeekHead, ID.Chapters, ID.Tags, ID.Attachments, ID.Segment]);

export class MatroskaDemuxer {
  constructor(source) {
    this.source = source;
    this.timestampScale = 1000000; // ns per tick (default 1ms)
    this.durationTicks = 0;
    this.tracks = [];
    this.cues = []; // { timeNs, clusterPos (absolute) }
    this.segStart = 0;
    this.firstClusterPos = 0;
  }

  get durationNs() { return this.durationTicks * this.timestampScale; }

  async init() {
    const s = new EbmlStream(this.source, 0, 1 << 20);
    // EBML header
    let id = await s.readId();
    if (id !== ID.EBMLHeader) throw new Error("not an EBML/Matroska file");
    let size = await s.readSize();
    await s.skip(size);
    // Segment
    id = await s.readId();
    if (id !== ID.Segment) throw new Error("no Segment element");
    await s.readSize(); // usually unknown; children follow
    this.segStart = s.pos;

    // Walk top-level children until we have Tracks (+SeekHead pointers).
    const seekTargets = {};
    let guard = 0;
    while (guard++ < 64) {
      const at = s.pos;
      let cid;
      try { cid = await s.readId(); } catch (e) { if (e instanceof EOFError) break; throw e; }
      const csz = await s.readSize();
      if (cid === ID.SeekHead) {
        await this.#parseSeekHead(s, csz, seekTargets);
      } else if (cid === ID.Info) {
        await this.#parseInfo(s, csz);
      } else if (cid === ID.Tracks) {
        await this.#parseTracks(s, csz);
      } else if (cid === ID.Cues) {
        await this.#parseCues(s, csz);
      } else if (cid === ID.Cluster) {
        this.firstClusterPos = at;
        break; // media starts; stop head scan
      } else {
        if (csz < 0) throw new Error("unexpected unknown-size element in head");
        await s.skip(csz);
      }
    }

    // Fetch out-of-line pieces the SeekHead pointed at (Cues live at
    // the end of well-muxed files).
    if (!this.tracks.length && seekTargets[ID.Tracks] != null) {
      await this.#parseElementAt(seekTargets[ID.Tracks], ID.Tracks, (st, sz) => this.#parseTracks(st, sz));
    }
    if (!this.cues.length && seekTargets[ID.Cues] != null) {
      try {
        await this.#parseElementAt(seekTargets[ID.Cues], ID.Cues, (st, sz) => this.#parseCues(st, sz));
      } catch { /* no cues: seeking degrades gracefully */ }
    }
    if (!this.tracks.length) throw new Error("no Tracks element found");
    if (!this.firstClusterPos) {
      // Head scan ended before a cluster (tracks were out-of-line);
      // find the first cluster by scanning from where we stopped.
      this.firstClusterPos = await this.#findFirstCluster(s.pos);
    }
    return this;
  }

  async #parseElementAt(segRelPos, expectId, fn) {
    const st = new EbmlStream(this.source, this.segStart + segRelPos, 1 << 20);
    const id = await st.readId();
    if (id !== expectId) throw new Error(`SeekHead pointed at 0x${id.toString(16)}, wanted 0x${expectId.toString(16)}`);
    const sz = await st.readSize();
    await fn(st, sz);
  }

  async #parseSeekHead(s, size, out) {
    const end = s.pos + size;
    while (s.pos < end) {
      const id = await s.readId();
      const sz = await s.readSize();
      if (id !== ID.Seek) { await s.skip(sz); continue; }
      const seekEnd = s.pos + sz;
      let target = 0, pos = -1;
      while (s.pos < seekEnd) {
        const iid = await s.readId();
        const isz = await s.readSize();
        const bytes = await s.readBytes(isz);
        if (iid === ID.SeekID) target = ebmlUint(bytes);
        else if (iid === ID.SeekPosition) pos = ebmlUint(bytes);
      }
      if (pos >= 0) out[target] = pos;
    }
  }

  async #parseInfo(s, size) {
    const end = s.pos + size;
    while (s.pos < end) {
      const id = await s.readId();
      const sz = await s.readSize();
      const bytes = await s.readBytes(sz);
      if (id === ID.TimestampScale) this.timestampScale = ebmlUint(bytes);
      else if (id === ID.Duration) this.durationTicks = ebmlFloat(bytes);
    }
  }

  async #parseTracks(s, size) {
    const end = s.pos + size;
    while (s.pos < end) {
      const id = await s.readId();
      const sz = await s.readSize();
      if (id !== ID.TrackEntry) { await s.skip(sz); continue; }
      const t = { number: 0, type: 0, codecId: "", codecPrivate: null, defaultDurationNs: 0, width: 0, height: 0, sampleRate: 0, channels: 0, isDefault: 1 };
      const tEnd = s.pos + sz;
      while (s.pos < tEnd) {
        const iid = await s.readId();
        const isz = await s.readSize();
        if (iid === ID.Video || iid === ID.Audio) {
          const subEnd = s.pos + isz;
          while (s.pos < subEnd) {
            const sid = await s.readId();
            const ssz = await s.readSize();
            const b = await s.readBytes(ssz);
            if (sid === ID.PixelWidth) t.width = ebmlUint(b);
            else if (sid === ID.PixelHeight) t.height = ebmlUint(b);
            else if (sid === ID.SamplingFrequency) t.sampleRate = Math.round(ebmlFloat(b));
            else if (sid === ID.Channels) t.channels = ebmlUint(b);
          }
          continue;
        }
        const bytes = await s.readBytes(isz);
        if (iid === ID.TrackNumber) t.number = ebmlUint(bytes);
        else if (iid === ID.TrackType) t.type = ebmlUint(bytes);
        else if (iid === ID.CodecID) t.codecId = ebmlString(bytes);
        else if (iid === ID.CodecPrivate) t.codecPrivate = bytes.slice();
        else if (iid === ID.DefaultDuration) t.defaultDurationNs = ebmlUint(bytes);
        else if (iid === ID.FlagDefault) t.isDefault = ebmlUint(bytes);
      }
      this.tracks.push(t);
    }
  }

  async #parseCues(s, size) {
    const end = s.pos + size;
    while (s.pos < end) {
      const id = await s.readId();
      const sz = await s.readSize();
      if (id !== ID.CuePoint) { await s.skip(sz); continue; }
      const cEnd = s.pos + sz;
      let time = 0, clusterPos = -1;
      while (s.pos < cEnd) {
        const iid = await s.readId();
        const isz = await s.readSize();
        if (iid === ID.CueTrackPositions) {
          const pEnd = s.pos + isz;
          while (s.pos < pEnd) {
            const pid = await s.readId();
            const psz = await s.readSize();
            const b = await s.readBytes(psz);
            if (pid === ID.CueClusterPosition) clusterPos = ebmlUint(b);
          }
        } else {
          const b = await s.readBytes(isz);
          if (iid === ID.CueTime) time = ebmlUint(b);
        }
      }
      if (clusterPos >= 0) {
        this.cues.push({ timeNs: time * this.timestampScale, clusterPos: this.segStart + clusterPos });
      }
    }
  }

  async #findFirstCluster(fromPos) {
    const s = new EbmlStream(this.source, fromPos, 1 << 20);
    let guard = 0;
    while (guard++ < 256) {
      const at = s.pos;
      const id = await s.readId();
      const sz = await s.readSize();
      if (id === ID.Cluster) return at;
      if (sz < 0) throw new Error("unknown-size non-cluster while scanning");
      await s.skip(sz);
    }
    throw new Error("no Cluster found");
  }

  // The cue point at-or-before timeNs (for seeking).
  cueFor(timeNs) {
    let best = null;
    for (const c of this.cues) {
      if (c.timeNs <= timeNs && (!best || c.timeNs > best.timeNs)) best = c;
    }
    return best;
  }

  // Async-iterate samples from an absolute cluster offset.
  // Yields { trackNumber, ptsNs, keyframe, data }.
  async *samples(fromClusterPos, signal) {
    const s = new EbmlStream(this.source, fromClusterPos || this.firstClusterPos, 4 << 20);
    while (true) {
      if (signal && signal.aborted) return;
      let id;
      try { id = await s.readId(); } catch (e) { if (e instanceof EOFError) return; throw e; }
      const size = await s.readSize();
      if (id !== ID.Cluster) {
        if (size < 0) return;
        await s.skip(size);
        continue;
      }
      const clusterEnd = size < 0 ? Infinity : s.pos + size;
      let clusterTicks = 0;
      while (s.pos < clusterEnd) {
        if (signal && signal.aborted) return;
        if (size < 0) {
          // Unknown-size cluster: peek — a top-level ID ends it.
          let next;
          try { next = await s.peekId(); } catch (e) { if (e instanceof EOFError) return; throw e; }
          if (next === -1 || TOP_LEVEL.has(next)) break;
        }
        let cid;
        try { cid = await s.readId(); } catch (e) { if (e instanceof EOFError) return; throw e; }
        const csz = await s.readSize();
        if (cid === ID.ClusterTimestamp) {
          clusterTicks = ebmlUint(await s.readBytes(csz));
        } else if (cid === ID.SimpleBlock) {
          const payload = await s.readBytes(csz);
          yield* this.#emitBlock(payload.slice(), clusterTicks, null);
        } else if (cid === ID.BlockGroup) {
          const gEnd = s.pos + csz;
          let block = null, hasRef = false;
          while (s.pos < gEnd) {
            const gid = await s.readId();
            const gsz = await s.readSize();
            if (gid === ID.Block) block = (await s.readBytes(gsz)).slice();
            else { if (gid === ID.ReferenceBlock) hasRef = true; await s.skip(gsz); }
          }
          if (block) yield* this.#emitBlock(block, clusterTicks, !hasRef);
        } else {
          await s.skip(csz);
        }
      }
    }
  }

  // Decode one (Simple)Block payload into 1..n samples (lacing).
  *#emitBlock(bytes, clusterTicks, groupKeyframe) {
    yield* parseBlock(bytes, clusterTicks, groupKeyframe, this.tracks, this.timestampScale);
  }
}

// Exported for direct testing: all three lacing modes live here.
export function* parseBlock(bytes, clusterTicks, groupKeyframe, tracks, timestampScale) {
  const tn = readVintFrom(bytes, 0);
  let at = tn.length;
  const rel = ((bytes[at] << 8) | bytes[at + 1]) << 16 >> 16; // int16
  at += 2;
  const flags = bytes[at++];
  const keyframe = groupKeyframe == null ? !!(flags & 0x80) : groupKeyframe;
  const lacing = (flags & 0x06) >> 1;

  const track = tracks.find((t) => t.number === tn.value);
  const baseNs = (clusterTicks + rel) * timestampScale;
  const stepNs = track ? track.defaultDurationNs : 0;

  let sizes;
  if (lacing === 0) {
    sizes = [bytes.length - at];
  } else {
    const count = bytes[at++] + 1;
    sizes = new Array(count);
    if (lacing === 2) { // fixed: equal parts of the remainder
      const total = bytes.length - at;
      for (let i = 0; i < count; i++) sizes[i] = total / count;
    } else if (lacing === 1) { // Xiph: 255-run coded, last implicit
      let sum = 0;
      for (let i = 0; i < count - 1; i++) {
        let v = 0;
        while (bytes[at] === 255) { v += 255; at++; }
        v += bytes[at++];
        sizes[i] = v; sum += v;
      }
      sizes[count - 1] = bytes.length - at - sum;
    } else { // EBML: first absolute vint, rest signed deltas
      const first = readVintFrom(bytes, at);
      at += first.length;
      sizes[0] = first.value;
      let prev = first.value, sum = first.value;
      for (let i = 1; i < count - 1; i++) {
        const d = readSignedVintFrom(bytes, at);
        at += d.length;
        prev += d.value;
        sizes[i] = prev; sum += prev;
      }
      if (count > 1) sizes[count - 1] = bytes.length - at - sum;
    }
  }

  for (let i = 0; i < sizes.length; i++) {
    const data = bytes.subarray(at, at + sizes[i]);
    at += sizes[i];
    yield {
      trackNumber: tn.value,
      ptsNs: baseNs + i * stepNs,
      keyframe: keyframe && i === 0 ? true : (track && track.type === 2 ? true : keyframe),
      data,
    };
  }
}
