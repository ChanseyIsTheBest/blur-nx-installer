// Blur's LZX buffers (XMemDecompress with a buffer context), in the page: the game keeps most of its shaders in LZX
// buffers inside its PAK2 archives (cache/shaders-speed.pak and the levels' paks). A port of blur-nx's
// app/src/blur_lzx_native.cpp, a decoder of Microsoft's framing written from the game's own code (its sub_829CC028 and
// helpers). libmspack's lzxd (wasm/lzx, the XEX's LZX) frames the stream differently in ways that change bytes (an odd
// uncompressed block's pad byte, one continuous bit stream instead of a restart at every frame, the E8 rule), so it is
// not used for these.
//
//   frames: 0xFF + BE16 uncompressed + BE16 compressed (5 bytes, the last frame) or BE16 compressed (2 bytes, 32 KB);
//           the remaining count starts at the buffer's size - 5 and the loop ends when it reaches 0 exactly;
//   bits:   a 32-bit buffer of 16-bit little-endian words, restarted at every frame (two words, count 16; not inside an
//           uncompressed block), refilled by one or two words when the count drops to 0 or below;
//   blocks: verbatim, aligned and uncompressed (backs up 2 bytes, R0-R2 as 12 little-endian bytes, no pad byte);
//   E8:     Microsoft's translation of each frame's output copy, when the first block's header asks for it.
//
// xmemDecompress(src, windowBytes, slots, expectedSize) -> Uint8Array, or throws on anything the game's decoder would
// not decode the same way.

const MAX_SLOTS = 51;
const MAIN_MAX = 256 + MAX_SLOTS * 8;
const LEN_SYMS = 249;
const TABLE_BITS = 11;

class Huffman {
  constructor() {
    this.table = new Uint16Array(1 << TABLE_BITS);
    this.sorted = new Uint16Array(MAIN_MAX);
    this.firstCode = new Int32Array(17);
    this.firstIndex = new Int32Array(17);
    this.count = new Int32Array(17);
    this.empty = true;
  }

  // false: a malformed tree (an empty one is valid until a symbol is asked of it).
  build(lens, n) {
    const count = this.count;
    count.fill(0);
    for (let i = 0; i < n; i++) {
      if (lens[i] > 16) return false;
      count[lens[i]]++;
    }
    count[0] = 0;
    let total = 0;
    for (let l = 1; l <= 16; l++) total += count[l];
    this.empty = total === 0;
    this.table.fill(0);
    if (this.empty) return true;
    // completeness: the Kraft sum exactly 1 (a single code of length 1 is the one incomplete tree LZX encoders write)
    let left = 1;
    for (let l = 1; l <= 16; l++) {
      left = left * 2 - count[l];
      if (left < 0) return false;
    }
    if (left !== 0 && total !== 1) return false;
    let code = 0, index = 0;
    for (let l = 1; l <= 16; l++) {
      code = l === 1 ? 0 : (code + count[l - 1]) << 1;
      this.firstCode[l] = code;
      this.firstIndex[l] = index;
      index += count[l];
    }
    const next = new Int32Array(17);
    for (let l = 1; l <= 16; l++) next[l] = this.firstIndex[l];
    for (let i = 0; i < n; i++) if (lens[i]) this.sorted[next[lens[i]]++] = i;
    for (let l = 1; l <= TABLE_BITS; l++) {
      for (let k = 0; k < count[l]; k++) {
        const sym = this.sorted[this.firstIndex[l] + k];
        const c = this.firstCode[l] + k;
        const lo = c << (TABLE_BITS - l), hi = (c + 1) << (TABLE_BITS - l);
        for (let e = lo; e < hi; e++) this.table[e] = (sym << 5) | l;
      }
    }
    return true;
  }
}

class Fail extends Error {}

class Decoder {
  constructor(windowBytes, slots, src) {
    this.window = new Uint8Array(windowBytes);
    this.wsize = windowBytes >>> 0;
    this.wmask = (windowBytes - 1) >>> 0;
    this.slots = slots;
    this.pos = 0;
    this.r0 = 1; this.r1 = 1; this.r2 = 1;
    this.mainLen = new Uint8Array(MAIN_MAX);
    this.prevMain = new Uint8Array(MAIN_MAX);
    this.lenLen = new Uint8Array(LEN_SYMS);
    this.prevLen = new Uint8Array(LEN_SYMS);
    this.alignedLen = new Uint8Array(8);
    this.mainTree = new Huffman();
    this.lenTree = new Huffman();
    this.alignedTree = new Huffman();
    this.preTree = new Huffman();
    this.blockType = 0;  // 0 none, 1 verbatim, 2 aligned, 3 uncompressed
    this.blockRemaining = 0;
    this.newBlock = true;
    this.firstBlock = true;
    this.e8Size = 0; this.e8Pos = 0; this.frames = 0;
    this.src = src;
    this.in = 0;
    this.inEnd = 0;
    this.bitbuf = 0;
    this.bitcount = 0;
    this.error = false;
    this.checkEnd = true;
    this.extraBits = new Uint32Array(MAX_SLOTS);
    this.pbase = new Uint32Array(MAX_SLOTS);
    for (let i = 0, b = 0; i < MAX_SLOTS; i++) {
      this.extraBits[i] = i < 4 ? 0 : Math.min((i - 2) >>> 1, 17);
      this.pbase[i] = b >>> 0;
      b += 2 ** this.extraBits[i];
    }
  }

  byte(i) { return this.src[i] | 0; }  // past the end: 0 (the guest reads the bytes after its frame)

  initBits() {
    if (this.blockType === 3) return;
    if (this.in + 4 > this.inEnd) return;
    const i = this.in;
    this.bitbuf = ((this.byte(i + 1) << 24) | (this.byte(i) << 16) | (this.byte(i + 3) << 8) | this.byte(i + 2)) >>> 0;
    this.bitcount = 16;
    this.in += 4;
  }

  fill(n) {
    this.bitcount -= n;
    this.bitbuf = (n >= 32 ? 0 : this.bitbuf << n) >>> 0;
    if (this.bitcount > 0) return;
    if (this.checkEnd && this.in >= this.inEnd) { this.error = true; return; }
    this.bitbuf = (this.bitbuf | ((this.byte(this.in) | (this.byte(this.in + 1) << 8)) << -this.bitcount)) >>> 0;
    this.in += 2;
    this.bitcount += 16;
    if (this.bitcount > 0) return;
    if (this.checkEnd && this.in >= this.inEnd) { this.error = true; return; }
    this.bitbuf = (this.bitbuf | ((this.byte(this.in) | (this.byte(this.in + 1) << 8)) << -this.bitcount)) >>> 0;
    this.in += 2;
    this.bitcount += 16;
  }

  get(n) {
    const v = n ? this.bitbuf >>> (32 - n) : 0;
    this.fill(n);
    return v;
  }

  symbol(h) {
    if (h.empty) return -1;
    const e = h.table[this.bitbuf >>> (32 - TABLE_BITS)];
    if (e) {
      this.fill(e & 31);
      return e >> 5;
    }
    for (let l = TABLE_BITS + 1; l <= 16; l++) {
      const c = this.bitbuf >>> (32 - l);
      const k = c - h.firstCode[l];
      if (k >= 0 && k < h.count[l]) {
        this.fill(l);
        return h.sorted[h.firstIndex[l] + k];
      }
    }
    return -1;
  }

  readLengths(lens, prev, first, last) {
    const preLens = new Uint8Array(20);
    for (let i = 0; i < 20; i++) preLens[i] = this.get(4);
    if (!this.preTree.build(preLens, 20)) throw new Fail('tree');
    for (let x = first; x < last;) {
      let z = this.symbol(this.preTree);
      if (z < 0) throw new Fail('tree');
      if (z === 17) {
        let y = this.get(4) + 4;
        if (x + y > last) throw new Fail('tree');
        while (y--) lens[x++] = 0;
      } else if (z === 18) {
        let y = this.get(5) + 20;
        if (x + y > last) throw new Fail('tree');
        while (y--) lens[x++] = 0;
      } else if (z === 19) {
        let y = this.get(1) + 4;
        if (x + y > last) throw new Fail('tree');
        z = this.symbol(this.preTree);
        if (z < 0 || z > 16) throw new Fail('tree');
        let v = prev[x] - z;
        if (v < 0) v += 17;
        while (y--) lens[x++] = v;
      } else {
        let v = prev[x] - z;
        if (v < 0) v += 17;
        lens[x++] = v;
      }
      if (this.error) throw new Fail('error flag');
    }
  }

  le32(i) { return (this.byte(i) | (this.byte(i + 1) << 8) | (this.byte(i + 2) << 16) | (this.byte(i + 3) << 24)) >>> 0; }

  startBlock() {
    if (this.firstBlock) {
      this.firstBlock = false;
      if (this.get(1)) {
        const hi = this.get(16), lo = this.get(16);
        this.e8Size = ((hi << 16) | lo) >>> 0;
      } else {
        this.e8Size = 0;
      }
    }
    if (this.blockType === 3) {
      this.blockType = 0;
      this.initBits();
    }
    this.blockType = this.get(3);
    const a = this.get(8), b = this.get(8), c = this.get(8);
    this.blockRemaining = (a << 16) | (b << 8) | c;
    if (this.blockType === 2) {
      for (let i = 0; i < 8; i++) this.alignedLen[i] = this.get(3);
      if (this.error) throw new Fail('error flag');
      if (!this.alignedTree.build(this.alignedLen, 8)) throw new Fail('tree');
    }
    if (this.blockType === 1 || this.blockType === 2) {
      const mainSyms = 256 + this.slots * 8;
      this.prevMain.set(this.mainLen.subarray(0, mainSyms));
      this.prevLen.set(this.lenLen);
      this.readLengths(this.mainLen, this.prevMain, 0, 256);
      this.readLengths(this.mainLen, this.prevMain, 256, mainSyms);
      if (!this.mainTree.build(this.mainLen, mainSyms)) throw new Fail('tree');
      this.readLengths(this.lenLen, this.prevLen, 0, LEN_SYMS);
      if (!this.lenTree.build(this.lenLen, LEN_SYMS)) throw new Fail('tree');
    } else if (this.blockType === 3) {
      this.in -= 2;
      if (this.in + 4 >= this.inEnd) throw new Fail('uncompressed block');
      this.r0 = this.le32(this.in);
      this.r1 = this.le32(this.in + 4);
      this.r2 = this.le32(this.in + 8);
      this.in += 12;
    } else {
      throw new Fail('block type');
    }
    if (this.error) throw new Fail('error flag');
    this.newBlock = false;
  }

  compressed(n) {
    this.checkEnd = false;
    try {
      const end = this.pos + n;
      const aligned = this.blockType === 2;
      const w = this.window, wmask = this.wmask;
      while (this.pos < end) {
        if (this.in >= this.inEnd || this.error) throw new Fail('error flag');
        const sym = this.symbol(this.mainTree);
        if (sym < 0) throw new Fail('tree');
        if (sym < 256) {
          w[this.pos++ & wmask] = sym;
          continue;
        }
        const m = sym - 256;
        let len = m & 7;
        const slot = m >> 3;
        if (len === 7) {
          const ls = this.symbol(this.lenTree);
          if (ls < 0) throw new Fail('tree');
          len += ls;
        }
        len += 2;
        let off;
        if (slot === 0) {
          off = this.r0;
        } else if (slot === 1) {
          off = this.r1;
          this.r1 = this.r0;
          this.r0 = off;
        } else if (slot === 2) {
          off = this.r2;
          this.r2 = this.r0;
          this.r0 = off;
        } else {
          const extra = this.extraBits[slot];
          off = (this.pbase[slot] - 2) >>> 0;
          if (aligned && extra >= 3) {
            if (extra > 3) off = (off + (this.get(extra - 3) << 3)) >>> 0;
            const a = this.symbol(this.alignedTree);
            if (a < 0) throw new Fail('tree');
            off = (off + a) >>> 0;
          } else if (extra) {
            off = (off + this.get(extra)) >>> 0;
          }
          this.r2 = this.r1;
          this.r1 = this.r0;
          this.r0 = off;
        }
        if (this.error) throw new Fail('error flag');
        if (this.pos + len > end) throw new Fail('match past its block');
        const from = (this.pos - off) & wmask;
        const to = this.pos & wmask;
        for (let i = 0; i < len; i++) w[(to + i) & wmask] = w[(from + i) & wmask];
        this.pos += len;
      }
      this.pos &= wmask;
    } finally {
      this.checkEnd = true;
    }
  }

  uncompressed(n) {
    if (n > this.inEnd - this.in) throw new Fail('uncompressed block');
    for (let i = 0; i < n; i++) this.window[(this.pos + i) & this.wmask] = this.byte(this.in + i);
    this.in += n;
    this.pos = (this.pos + n) & this.wmask;
  }

  decodeData(amount) {
    let done = 0;
    let left = amount;
    while (left > 0) {
      if (this.newBlock) this.startBlock();
      while (this.blockRemaining > 0 && left > 0) {
        const n = Math.min(this.blockRemaining, left);
        if (this.blockType === 3) this.uncompressed(n);
        else if (this.blockType === 1 || this.blockType === 2) this.compressed(n);
        else throw new Fail('block type');
        left -= n;
        done += n;
        this.blockRemaining -= n;
      }
      if (this.blockRemaining === 0) this.newBlock = true;
      if (left === 0) this.initBits();
    }
    return done;
  }

  e8(buf, n) {
    if (n <= 6) {
      this.e8Pos = (this.e8Pos + n) >>> 0;
      return;
    }
    const saved = buf.slice(n - 6, n);
    buf.fill(0xE8, n - 6, n);
    const end = (this.e8Pos + n - 10) >>> 0;
    let p = 0;
    for (;;) {
      let skipped = 0;
      while (buf[p] !== 0xE8) { p++; skipped++; }
      this.e8Pos = (this.e8Pos + skipped) >>> 0;
      const cur = this.e8Pos;
      const q = p + 1;
      if (cur >= end) break;
      const abs = (buf[q] | (buf[q + 1] << 8) | (buf[q + 2] << 16) | (buf[q + 3] << 24)) >>> 0;
      let rel = 0;
      let write = false;
      if (abs < this.e8Size) {
        rel = (abs - cur) >>> 0;
        write = true;
      } else if (((0 - abs) >>> 0) <= cur) {
        rel = (abs + this.e8Size) >>> 0;
        write = true;
      }
      if (write) {
        buf[q] = rel & 0xFF;
        buf[q + 1] = (rel >>> 8) & 0xFF;
        buf[q + 2] = (rel >>> 16) & 0xFF;
        buf[q + 3] = (rel >>> 24) & 0xFF;
      }
      this.e8Pos = (cur + 5) >>> 0;
      p = q + 4;
    }
    this.e8Pos = (end + 10) >>> 0;
    buf.set(saved, n - 6);
  }
}

export function xmemDecompress(src, windowBytes, slots, expectedSize) {
  if (windowBytes < 0x8000 || windowBytes > 0x200000 || (windowBytes & (windowBytes - 1)) || slots < 30 ||
      slots > MAX_SLOTS) {
    throw new Error(`an LZX buffer of window ${windowBytes} and ${slots} slots: not one this page decodes`);
  }
  const d = new Decoder(windowBytes, slots, src);
  const parts = [];
  let total = 0;
  let remaining = src.length > 5 ? src.length - 5 : 0;
  let p = 0;
  try {
    while (remaining !== 0) {
      let comp, uncomp;
      if (src[p] === 0xFF) {
        if (remaining < 5) throw new Fail('framing');
        remaining -= 5;
        uncomp = (src[p + 1] << 8) | src[p + 2];
        comp = (src[p + 3] << 8) | src[p + 4];
        p += 5;
        if (comp < remaining) remaining = comp;
      } else {
        if (remaining < 2) throw new Fail('framing');
        comp = (src[p] << 8) | src[p + 1];
        uncomp = 0x8000;
        p += 2;
        remaining -= 2;
      }
      if (comp > remaining || uncomp > 0x8000 || uncomp === 0) throw new Fail('framing');
      d.in = p;
      d.inEnd = p + comp + 4;
      d.initBits();
      const done = d.decodeData(uncomp);
      if (d.error) throw new Fail('error flag');
      const last = d.pos ? d.pos : d.wsize;
      if (done > last) throw new Fail('framing');
      const frame = d.window.slice(last - done, last);
      if (d.e8Size !== 0 && d.frames < 32768) d.e8(frame, done);
      d.frames++;
      parts.push(frame);
      total += done;
      remaining -= comp;
      p += comp;
    }
  } catch (e) {
    if (e instanceof Fail) throw new Error(`an LZX buffer the page cannot decode as the game does (${e.message})`);
    throw e;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  if (expectedSize !== undefined && total !== expectedSize) {
    throw new Error(`an LZX buffer decoded to ${total} bytes, ${expectedSize} expected`);
  }
  return out;
}
