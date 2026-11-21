// blur-nx-installer (2026-11-21, the user: "rencode video and audio to opus and h265", "also Bink videos ZXC compressed
// loading as well like sart"): one of Blur's Bink 1 movies (Ui/movies/*.bik, "BIKi") as NAME.bik.hevc, the movie with
// its pictures as H.265, which lib/install.js then packs as ZXC blocks (NAME.bik.hevc.lz4b). The format is rr6-nx's
// (sdk/include/rex/filesystem/sfd_hevc.h); blur-nx's app/src/cpu/blur_bink_hevc.cpp plays it on the Switch's NVDEC, and
// its tools/bik_hevc_pack.py makes the same file with ffmpeg. rr6-nx-installer's lib/sfdh.js with a Bink reader instead
// of its MPEG-1 one (credit rr6-nx and culdcept-nx):
//   1. each frame's video data found (the bytes after the frame's audio tracks; every other byte is kept as it is);
//   2. each frame decoded (wasm/bink: FFmpeg's Bink decoder; Bink has no reordering) and encoded by the browser's H.265
//      encoder (WebCodecs, the computer's video hardware) at `fraction` of the movie's own video bitrate, a keyframe
//      every `gop` frames, one picture out per picture in, no reordering;
//   3. NAME.bik.hevc written: the .bik's bytes but each frame's video data (a 10-byte tag, then zeros), and the H.265
//      frames, each led by an access unit delimiter.
// Returns { bytes: null, why } (the .bik is packed as it is) when the browser has no H.265 encoder or something does not
// fit.
const MAGIC = 'RXSFDH01';
const TAG_BYTES = 10;
const AUD = new Uint8Array([0, 0, 0, 1, 0x46, 0x01, 0x50]);  // an H.265 access unit delimiter

// rr6-nx-installer's: Main profile, level 4, Annex B (start codes), the video hardware when there is one
export function hevcConfig(width, height, kbps, fps) {
  return {
    codec: 'hvc1.1.6.L120.B0',
    width, height,
    bitrate: Math.round(kbps * 1000),
    bitrateMode: 'variable',
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality',
    hevc: { format: 'annexb' },
  };
}

export async function canEncodeHevc() {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    return !!(await VideoEncoder.isConfigSupported(hevcConfig(1280, 720, 2500, 30))).supported;
  } catch {
    return false;
  }
}

// Bink 1's layout (little-endian): 0 "BIK" and the revision, 8 the frame count, 20 width, 24 height, 28 / 32 the frame
// rate's numerator / denominator, 36 the video flags, 40 the audio track count T, then 12 x T bytes of track data, then
// (frames + 1) u32 offsets (bit 0: a keyframe), frame 0 right after them. A frame: for each audio track a u32 size and
// that many bytes, then the video data to the frame's end.
// -> { vids: [[start, end]], width, height, fps, tag, flags, videoBytes }; throws when the file is not one of these.
export function binkVideo(d) {
  if (d.length < 44 || d[0] !== 0x42 || d[1] !== 0x49 || d[2] !== 0x4B) throw new Error('not a Bink file');
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const tag = v.getUint32(0, true);
  const revision = String.fromCharCode(d[3]);
  if (revision < 'c' || revision > 'i') throw new Error(`Bink revision ${revision}, not one this installer reads`);
  const frames = v.getUint32(8, true);
  const width = v.getUint32(20, true), height = v.getUint32(24, true);
  const fpsNum = v.getUint32(28, true), fpsDen = v.getUint32(32, true);
  const flags = v.getUint32(36, true);
  const tracks = v.getUint32(40, true);
  if (!frames || !fpsNum || !fpsDen || width & 1 || height & 1) throw new Error('a Bink header this installer does not read');
  if (flags & 0x00100000) throw new Error('a Bink movie with alpha');  // H.265 has no alpha plane
  const indexAt = 44 + 12 * tracks;
  if (indexAt + 4 * (frames + 1) > d.length) throw new Error('the frame index runs past the file');
  const offset = (i) => v.getUint32(indexAt + 4 * i, true) & ~1;
  if (offset(0) !== indexAt + 4 * (frames + 1) || offset(frames) > d.length) {
    throw new Error('the frame index is not where Bink 1 has it');
  }
  const vids = [];
  let videoBytes = 0;
  for (let i = 0; i < frames; i++) {
    let p = offset(i);
    const end = offset(i + 1);
    if (end < p) throw new Error(`frame ${i} ends before it starts`);
    for (let t = 0; t < tracks; t++) {
      if (p + 4 > end) throw new Error(`frame ${i}: its audio runs past the frame`);
      p += 4 + v.getUint32(p, true);
    }
    if (p > end || end - p < TAG_BYTES) throw new Error(`frame ${i}: ${end - p} bytes of video data, too few for a tag`);
    vids.push([p, end]);
    videoBytes += end - p;
  }
  return { vids, width, height, fps: fpsNum / fpsDen, tag, flags, videoBytes };
}

// ---- the .hevc file (rr6-nx's format) ------------------------------------------------------------------------------

// Segments: the file as it is (kind 0, from the stored bytes) but each frame's video data: its tag (kind 2, picture k)
// and zeros (kind 1). The pictures table maps a tag's index to a frame: here frame k is picture k.
function build(d, vids, frames, width, height, fps) {
  const segs = [], stored = [];
  let storedLen = 0, pos = 0;
  const addStored = (from, to) => {
    segs.push({ off: from, len: to - from, kind: 0, pic: 0, src: storedLen });
    stored.push(d.subarray(from, to));
    storedLen += to - from;
  };
  vids.forEach(([vs, ve], k) => {
    if (vs > pos) addStored(pos, vs);
    segs.push({ off: vs, len: TAG_BYTES, kind: 2, pic: k, src: 0 });
    if (ve > vs + TAG_BYTES) segs.push({ off: vs + TAG_BYTES, len: ve - vs - TAG_BYTES, kind: 1, pic: 0, src: 0 });
    pos = ve;
  });
  if (pos < d.length) addStored(pos, d.length);
  const hdr = 96, segOff = hdr, storedOff = segOff + 32 * segs.length, picOff = storedOff + storedLen;
  const frameTab = picOff + 4 * vids.length, dataOff = frameTab + 16 * frames.length;
  const head = new Uint8Array(storedOff);
  const v = new DataView(head.buffer);
  const u64 = (dv, o, x) => { dv.setUint32(o, x % 0x100000000, true); dv.setUint32(o + 4, Math.floor(x / 0x100000000), true); };
  for (let i = 0; i < 8; i++) head[i] = MAGIC.charCodeAt(i);
  v.setUint32(8, 1, true);
  v.setUint32(12, segs.length, true);
  u64(v, 16, d.length);
  u64(v, 24, segOff);
  u64(v, 32, storedOff);
  u64(v, 40, storedLen);
  v.setUint32(48, vids.length, true);
  u64(v, 56, picOff);
  v.setUint32(64, width, true);
  v.setUint32(68, height, true);
  v.setUint32(72, frames.length, true);
  v.setUint32(76, Math.round(fps * 1000), true);
  u64(v, 80, frameTab);
  segs.forEach((s, i) => {
    const o = segOff + 32 * i;
    u64(v, o, s.off);
    u64(v, o + 8, s.len);
    v.setUint32(o + 16, s.kind, true);
    v.setUint32(o + 20, s.pic, true);
    u64(v, o + 24, s.src);
  });
  const tail = new Uint8Array(4 * vids.length + 16 * frames.length);
  const tv = new DataView(tail.buffer);
  vids.forEach((_, i) => tv.setUint32(4 * i, i, true));
  let at = dataOff;
  frames.forEach((f, i) => {
    const o = 4 * vids.length + 16 * i;
    u64(tv, o, at);
    tv.setUint32(o + 8, f.data.length, true);
    tv.setUint32(o + 12, f.key ? 1 : 0, true);
    at += f.data.length;
  });
  return new Blob([head, ...stored, tail, ...frames.map((f) => f.data)]);
}

// The H.265 frames as the port takes them: in order, the first a keyframe, each led by an access unit delimiter.
// -> [{ data, key }] or a string saying why not.
export function accessUnits(chunks, count) {
  if (chunks.length !== count) return `${chunks.length} H.265 frames for ${count}`;
  for (let i = 1; i < chunks.length; ++i)
    if (chunks[i].timestamp <= chunks[i - 1].timestamp) return 'the encoder reordered frames';
  if (!chunks[0].key) return 'the first H.265 frame is not a keyframe';
  const startsWithAud = (c) => {
    const i = c[2] === 1 ? 3 : c[3] === 1 ? 4 : -1;
    return c[0] === 0 && c[1] === 0 && i > 0 && ((c[i] >> 1) & 0x3f) === 35;
  };
  return chunks.map((c) => {
    if (startsWithAud(c.data)) return { data: c.data, key: c.key };
    const data = new Uint8Array(AUD.length + c.data.length);
    data.set(AUD);
    data.set(c.data, AUD.length);
    return { data, key: c.key };
  });
}

// bytes: the .bik; bink: an instance of wasm/bink.mjs. -> { bytes: Blob, frames, kbps } or { bytes: null, why }.
export async function reencodeBink(bytes, bink, { fraction = 0.22, gop = 120, minKbps = 300 } = {}) {
  let movie;
  try {
    movie = binkVideo(bytes);
  } catch (e) {
    return { bytes: null, why: e.message || String(e) };
  }
  const { vids, width, height, fps, tag, flags, videoBytes } = movie;
  const kbps = Math.max(minKbps, videoBytes * 8 / (vids.length / fps) / 1000 * fraction);
  const config = hevcConfig(width, height, kbps, Math.round(fps));
  if (!(await VideoEncoder.isConfigSupported(config)).supported) return { bytes: null, why: 'this browser has no H.265 encoder' };
  if (bink._bink_open(width, height, tag, flags) < 0) return { bytes: null, why: 'the Bink decoder did not open' };
  const frameBytes = width * height * 3 / 2;
  let inputSize = 1 << 20, input = bink._bink_malloc(inputSize);
  const chunks = [];
  let failure = null, shown = 0;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, key: chunk.type === 'key', timestamp: chunk.timestamp });
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(config);
  try {
    for (let k = 0; k < vids.length && !failure; k++) {
      const [a, b] = vids[k];
      const len = b - a;
      if (len > inputSize) {
        bink._bink_free(input);
        inputSize = len;
        input = bink._bink_malloc(inputSize);
      }
      bink.HEAPU8.set(bytes.subarray(a, b), input);
      if (bink._bink_decode(input, len) !== 1) return { bytes: null, why: `Bink frame ${k} did not decode` };
      const p = bink._bink_picture();
      const frame = new VideoFrame(bink.HEAPU8.slice(p, p + frameBytes), {
        format: 'I420', codedWidth: width, codedHeight: height,
        timestamp: Math.round(shown * 1e6 / fps), duration: Math.round(1e6 / fps),
      });
      encoder.encode(frame, { keyFrame: shown % gop === 0 });
      frame.close();
      shown++;
      while (encoder.encodeQueueSize > 8 && !failure) await new Promise((r) => setTimeout(r, 1));
    }
    if (!failure) await encoder.flush();
  } catch (e) {
    failure = failure || e;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    bink._bink_free(input);
    bink._bink_close();
  }
  if (failure) return { bytes: null, why: `the encoder failed: ${failure.message || failure}` };
  if (shown !== vids.length) return { bytes: null, why: `${shown} frames decoded of ${vids.length}` };
  const frames = accessUnits(chunks, vids.length);
  if (typeof frames === 'string') return { bytes: null, why: frames };
  return { bytes: build(bytes, vids, frames, width, height, fps), frames: frames.length, kbps: Math.round(kbps), why: null };
}

// For test/biks_node.mjs: the parts that need no browser.
export const __test = { build };
