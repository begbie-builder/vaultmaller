// ============================================================
//  HTTP byte-range source. The whole transmux pipeline sits on
//  this one primitive: read(offset, length) -> Uint8Array.
//
//  Safari-grade requirements enforced here:
//  - Every media read is an explicit `Range: bytes=a-b` request
//    and the origin MUST answer 206 with Content-Range. A 200
//    means the server ignored the range (it would ship us the
//    whole 40GB file), so we fail loudly instead of "working".
//  - `Range` is not a CORS-safelisted header → every request
//    preflights. The origin must answer OPTIONS with every header
//    we send (Range, Authorization, Dropbox-API-Arg) allow-listed.
//    Auth travels in headers, never in cookies that Safari's ITP
//    would strip.
// ============================================================

export class HttpRangeSource {
  // getTarget: async () => string | { url, headers }
  // (re-invoked once on 401 so expiring tokens can be re-minted mid-movie)
  constructor(getTarget) {
    this.getTarget = typeof getTarget === "function" ? getTarget : async () => getTarget;
    this.target = null;
    this.size = 0; // learned from the first Content-Range
  }

  async #fetch(offset, length, retried) {
    if (!this.target) {
      const t = await this.getTarget();
      this.target = typeof t === "string" ? { url: t, headers: {} } : { headers: {}, ...t };
    }
    const end = offset + length - 1;
    const res = await fetch(this.target.url, {
      method: "GET",
      headers: { ...this.target.headers, Range: `bytes=${offset}-${end}` },
      cache: "no-store",
    });
    if (res.status === 401 && !retried) {
      this.target = null; // token expired mid-stream: re-mint once
      return this.#fetch(offset, length, true);
    }
    if (res.status === 416) return null; // past EOF
    if (res.status === 200) {
      // Origin ignored the range. Abort rather than stream the world.
      res.body && res.body.cancel && res.body.cancel();
      throw new Error("Server ignored the byte-range request (200 instead of 206); streaming would download the entire file.");
    }
    if (res.status !== 206) throw new Error(`Range request failed: HTTP ${res.status}`);
    const cr = res.headers.get("Content-Range"); // "bytes a-b/total"
    if (cr) {
      const total = parseInt(cr.split("/")[1], 10);
      if (Number.isFinite(total)) this.size = total;
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  // Returns up to `length` bytes at `offset`; null/short at EOF.
  async read(offset, length) {
    if (this.size && offset >= this.size) return null;
    if (this.size && offset + length > this.size) length = this.size - offset;
    return this.#fetch(offset, length, false);
  }
}
