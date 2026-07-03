// ============================================================
//  TransmuxPlayer: plays Matroska files in browsers that refuse
//  the container (Safari, chiefly) by rewrapping the untouched
//  compressed samples into fragmented MP4 and feeding Media
//  Source Extensions. No re-encode: HEVC/H.264 decode still
//  happens in silicon; we only translate the wrapper.
//
//  iOS 17.1+ exposes ManagedMediaSource instead of MediaSource;
//  we use whichever exists (MMS additionally wants remote
//  playback disabled before attaching).
// ============================================================
import { MatroskaDemuxer } from "./matroska.js";
import { FragmentAssembler } from "./assembler.js";
import { initSegment, avcCodecString, hevcCodecString, vp9CodecString, aacCodecString } from "./fmp4.js";

const MSImpl = () => self.ManagedMediaSource || self.MediaSource;

const VIDEO_CODECS = {
  "V_MPEG4/ISO/AVC": { codec: "avc", str: avcCodecString },
  "V_MPEGH/ISO/HEVC": { codec: "hevc", str: hevcCodecString },
  "V_VP9": { codec: "vp9", str: vp9CodecString, noPriv: true },
};
const AUDIO_CODECS = {
  "A_AAC": { codec: "aac", str: aacCodecString },
};

export function transmuxSupported() { return !!MSImpl(); }

export class TransmuxPlayer {
  // source: HttpRangeSource-compatible; onNote(msg) surfaces caveats
  constructor(video, source, { onNote } = {}) {
    this.video = video;
    this.source = source;
    this.onNote = onNote || (() => {});
    this.gen = 0;             // seek/teardown generation
    this.abort = null;        // AbortController for the demux loop
    this.objectUrl = null;
    this.queues = new Map();  // SourceBuffer -> append promise chain
    this.onSeeking = null;
    this.destroyed = false;
  }

  async start() {
    const MS = MSImpl();
    if (!MS) throw Object.assign(new Error("MediaSource unavailable"), { reason: "nomse" });

    this.demux = await new MatroskaDemuxer(this.source).init();

    // ---- pick tracks & prove decodability BEFORE any UI commitment ----
    const vSrc = this.demux.tracks.find((t) => t.type === 1 && VIDEO_CODECS[t.codecId] && (t.codecPrivate || VIDEO_CODECS[t.codecId].noPriv));
    if (!vSrc) throw Object.assign(new Error("no supported video track"), { reason: "container" });
    const vMap = VIDEO_CODECS[vSrc.codecId];
    const vCodecStr = vMap.str(vSrc.codecPrivate);
    const vMime = `video/mp4; codecs="${vCodecStr}"`;
    if (!MS.isTypeSupported(vMime)) {
      throw Object.assign(new Error(`browser cannot decode ${vCodecStr}`), { reason: "codec", codec: vCodecStr });
    }

    let aSrc = this.demux.tracks.find((t) => t.type === 2 && AUDIO_CODECS[t.codecId] && t.codecPrivate && t.isDefault)
      || this.demux.tracks.find((t) => t.type === 2 && AUDIO_CODECS[t.codecId] && t.codecPrivate);
    let aMime = null, aCodecStr = null;
    if (aSrc) {
      aCodecStr = AUDIO_CODECS[aSrc.codecId].str(aSrc.codecPrivate);
      aMime = `audio/mp4; codecs="${aCodecStr}"`;
      if (!MS.isTypeSupported(aMime)) aSrc = null;
    }
    if (!aSrc) {
      const other = this.demux.tracks.find((t) => t.type === 2);
      if (other) this.onNote(`Audio track (${other.codecId.replace("A_", "")}) isn't decodable in this browser; playing video only.`);
    }

    this.vTrack = {
      id: 1, timescale: 90000, isVideo: true,
      codec: vMap.codec, codecPrivate: vSrc.codecPrivate,
      width: vSrc.width, height: vSrc.height,
      defaultDurationNs: vSrc.defaultDurationNs,
      srcNumber: vSrc.number,
    };
    this.aTrack = aSrc ? {
      id: 2, timescale: aSrc.sampleRate || 48000, isVideo: false,
      codec: "aac", codecPrivate: aSrc.codecPrivate,
      channels: aSrc.channels || 2, sampleRate: aSrc.sampleRate || 48000,
      // AAC frame = 1024 samples ⇒ exact tick duration at rate timescale
      defaultDurationNs: 1024 / (aSrc.sampleRate || 48000) * 1e9,
      srcNumber: aSrc.number,
    } : null;

    // ---- attach MediaSource ----
    if (self.ManagedMediaSource && MS === self.ManagedMediaSource) {
      this.video.disableRemotePlayback = true;
    }
    this.ms = new MS();
    this.objectUrl = URL.createObjectURL(this.ms);
    await new Promise((resolve, reject) => {
      this.ms.addEventListener("sourceopen", resolve, { once: true });
      this.video.addEventListener("error", () => reject(new Error("media element error during attach")), { once: true });
      this.video.src = this.objectUrl;
    });
    if (this.demux.durationNs) {
      try { this.ms.duration = this.demux.durationNs / 1e9; } catch { /* non-fatal */ }
    }

    this.sbV = this.ms.addSourceBuffer(vMime);
    this.queues.set(this.sbV, Promise.resolve());
    this.#append(this.sbV, initSegment(this.vTrack));
    if (this.aTrack) {
      this.sbA = this.ms.addSourceBuffer(aMime);
      this.queues.set(this.sbA, Promise.resolve());
      this.#append(this.sbA, initSegment(this.aTrack));
    }

    this.onSeeking = () => this.#seek(this.video.currentTime);
    this.video.addEventListener("seeking", this.onSeeking);

    this.#pump(++this.gen, this.demux.firstClusterPos);
    return { videoCodec: vCodecStr, audioCodec: aCodecStr, seekable: this.demux.cues.length > 0 };
  }

  // Serialized appendBuffer with quota-pressure eviction.
  #append(sb, bytes) {
    const run = async () => {
      if (this.destroyed) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          sb.appendBuffer(bytes);
          await new Promise((res, rej) => {
            const ok = () => { cleanup(); res(); };
            const err = () => { cleanup(); rej(new Error("SourceBuffer append error")); };
            const cleanup = () => { sb.removeEventListener("updateend", ok); sb.removeEventListener("error", err); };
            sb.addEventListener("updateend", ok, { once: true });
            sb.addEventListener("error", err, { once: true });
          });
          return;
        } catch (e) {
          if (e.name === "QuotaExceededError" && attempt === 0) {
            const keepFrom = Math.max(0, this.video.currentTime - 15);
            if (keepFrom > 0.5) {
              sb.remove(0, keepFrom);
              await new Promise((res) => sb.addEventListener("updateend", res, { once: true }));
              continue; // retry once with room freed
            }
          }
          throw e;
        }
      }
    };
    const chained = this.queues.get(sb).then(run, run);
    this.queues.set(sb, chained);
    return chained;
  }

  #bufferedAhead() {
    const b = this.video.buffered;
    const t = this.video.currentTime;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t + 0.5 && b.end(i) > t) return b.end(i) - t;
    }
    return 0;
  }

  async #pump(gen, fromPos) {
    const controller = new AbortController();
    this.abort = controller;
    const mkAsm = (track) => new FragmentAssembler(track, (bytes) => {
      if (gen === this.gen) this.#append(track.isVideo ? this.sbV : this.sbA, bytes).catch(() => controller.abort());
    });
    const vAsm = mkAsm(this.vTrack);
    const aAsm = this.aTrack ? mkAsm(this.aTrack) : null;

    try {
      for await (const s of this.demux.samples(fromPos, controller.signal)) {
        if (gen !== this.gen || this.destroyed) return;
        if (s.trackNumber === this.vTrack.srcNumber) vAsm.push(s);
        else if (aAsm && s.trackNumber === this.aTrack.srcNumber) aAsm.push(s);
        // Backpressure: keep ~90s ahead, no more (memory + quota).
        while (gen === this.gen && !this.destroyed && this.#bufferedAhead() > 90 && !this.video.paused) {
          await new Promise((r) => setTimeout(r, 500));
        }
        while (gen === this.gen && !this.destroyed && this.#bufferedAhead() > 150) {
          await new Promise((r) => setTimeout(r, 800)); // paused: cap harder
        }
      }
      if (gen !== this.gen || this.destroyed) return;
      vAsm.flush();
      if (aAsm) aAsm.flush();
      await Promise.all([...this.queues.values()]);
      if (gen === this.gen && !this.destroyed && this.ms.readyState === "open") {
        try { this.ms.endOfStream(); } catch { /* already ended */ }
      }
    } catch (e) {
      if (gen === this.gen && !this.destroyed) {
        this.onNote(`Streaming stopped: ${e.message}`);
      }
    }
  }

  #seek(timeSec) {
    if (this.destroyed) return;
    const cue = this.demux.cueFor(timeSec * 1e9);
    const from = cue ? cue.clusterPos : this.demux.firstClusterPos;
    // Already buffered? The element will jump on its own; keep pumping.
    const b = this.video.buffered;
    for (let i = 0; i < b.length; i++) {
      if (timeSec >= b.start(i) && timeSec < b.end(i) - 1) return;
    }
    const gen = ++this.gen;
    if (this.abort) this.abort.abort();
    const restart = async () => {
      // Let in-flight appends drain, then clear pending ops.
      await Promise.allSettled([...this.queues.values()]);
      for (const sb of [this.sbV, this.sbA]) {
        if (sb && sb.updating) { try { sb.abort(); } catch { /* fine */ } }
      }
      if (gen !== this.gen || this.destroyed) return;
      this.#pump(gen, from);
    };
    restart();
  }

  destroy() {
    this.destroyed = true;
    this.gen++;
    if (this.abort) this.abort.abort();
    if (this.onSeeking) this.video.removeEventListener("seeking", this.onSeeking);
    try { if (this.ms && this.ms.readyState === "open") this.ms.endOfStream(); } catch { /* detaching anyway */ }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.video.removeAttribute("src");
    this.video.load();
  }
}
