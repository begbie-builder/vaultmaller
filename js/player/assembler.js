// ============================================================
//  Fragment assembly: groups demuxed samples into keyframe-led
//  fragments and reconstructs DTS for B-frame streams.
//
//  Matroska stores PRESENTATION timestamps in DECODE order. MP4
//  needs a monotonic decode timeline plus signed composition
//  offsets. Within one GOP, assigning the k-th decode-order
//  sample the k-th smallest PTS yields a valid monotone DTS with
//  cts = pts - dts absorbing the reorder (the classic x264
//  pts→dts construction). Fragments start at keyframes, which is
//  also what MSE wants.
// ============================================================
import { fragment } from "./fmp4.js";

const NS = 1e9;

export class FragmentAssembler {
  // track: { id, timescale, isVideo, defaultDurationNs }
  // onFragment(bytes, firstPtsSec)
  constructor(track, onFragment) {
    this.track = track;
    this.onFragment = onFragment;
    this.buf = [];
    this.seq = 0;
    this.prevDtsEnd = -Infinity; // monotonic guard across fragments
    this.maxBatch = track.isVideo ? 512 : 48;
    this.maxDurTicks = track.timescale * 8; // split monster GOPs at ~8s
  }

  #ticks(ns) { return Math.round(ns * this.track.timescale / NS); }

  push(sample) {
    const s = { pts: this.#ticks(sample.ptsNs), sync: !!sample.keyframe, data: sample.data };
    if (this.track.isVideo) {
      const spanned = this.buf.length && (s.pts - this.buf[0].pts) > this.maxDurTicks;
      if ((s.sync && this.buf.length) || this.buf.length >= this.maxBatch || spanned) this.flush();
    } else if (this.buf.length >= this.maxBatch) {
      this.flush();
    }
    this.buf.push(s);
  }

  flush() {
    if (!this.buf.length) return;
    const n = this.buf.length;
    // k-th smallest PTS becomes the k-th DTS (identity for no-B streams).
    const sorted = this.buf.map((s) => s.pts).sort((a, b) => a - b);
    // Strictly monotonic, continuing on from the previous fragment.
    const dts = new Array(n);
    let prev = this.prevDtsEnd;
    for (let i = 0; i < n; i++) {
      dts[i] = sorted[i] > prev ? sorted[i] : prev + 1;
      prev = dts[i];
    }
    const defDur = this.track.defaultDurationNs
      ? this.#ticks(this.track.defaultDurationNs)
      : (n > 1 ? Math.max(1, Math.round((dts[n - 1] - dts[0]) / (n - 1))) : this.track.timescale / 30);
    const rows = this.buf.map((s, i) => ({
      data: s.data,
      duration: i < n - 1 ? Math.max(1, dts[i + 1] - dts[i]) : Math.max(1, defDur),
      cts: s.pts - dts[i], // signed; trun v1 carries it
      sync: this.track.isVideo ? s.sync : true,
    }));
    this.prevDtsEnd = dts[n - 1] + rows[n - 1].duration - 1;
    const bytes = fragment(this.track, ++this.seq, dts[0], rows);
    const firstPtsSec = sorted[0] / this.track.timescale;
    this.buf = [];
    this.onFragment(bytes, firstPtsSec);
  }

  // After a seek the timeline restarts wherever the cue landed us.
  reset() {
    this.buf = [];
    this.prevDtsEnd = -Infinity;
  }
}
