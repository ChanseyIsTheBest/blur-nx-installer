// blur-nx-installer 1.0.1: checks lib/biks.js's Bink reader and .hevc writer against blur-nx's tools/bik_hevc_pack.py.
// The H.265 frames are taken from the packer's own NAME.bik.hevc (made with ffmpeg), so the JavaScript writes the same
// file from the same frames when its segments, tables and header are the packer's, byte for byte.
//   node test/biks_node.mjs IN.bik REF.bik.hevc
import { readFileSync } from 'node:fs';
import { __test, accessUnits, binkVideo } from '../lib/biks.js';

const [bikPath, refPath] = process.argv.slice(2);
if (!refPath) {
  console.error('usage: node test/biks_node.mjs IN.bik REF.bik.hevc');
  process.exit(2);
}
const bik = new Uint8Array(readFileSync(bikPath));
const ref = new Uint8Array(readFileSync(refPath));
const rv = new DataView(ref.buffer, ref.byteOffset, ref.byteLength);
const u64 = (o) => rv.getUint32(o, true) + rv.getUint32(o + 4, true) * 0x100000000;
if (new TextDecoder().decode(ref.subarray(0, 8)) !== 'RXSFDH01') throw new Error(`${refPath}: not a .hevc movie`);
const frameCount = rv.getUint32(72, true), frameTab = u64(80);
const chunks = [];
for (let i = 0; i < frameCount; i++) {
  const o = frameTab + 16 * i, at = u64(o), size = rv.getUint32(o + 8, true);
  chunks.push({ data: ref.subarray(at, at + size), key: !!(rv.getUint32(o + 12, true) & 1), timestamp: i });
}
const movie = binkVideo(bik);
console.log(`${bikPath}: ${movie.vids.length} frames, ${movie.width}x${movie.height} at ${movie.fps.toFixed(3)} fps, ` +
            `${(movie.videoBytes / 1048576).toFixed(1)} MB of video data of ${(bik.length / 1048576).toFixed(1)} MB`);
const frames = accessUnits(chunks, movie.vids.length);
if (typeof frames === 'string') throw new Error(frames);
const out = new Uint8Array(await __test.build(bik, movie.vids, frames, movie.width, movie.height, movie.fps).arrayBuffer());
let first = -1;
const n = Math.min(out.length, ref.length);
for (let i = 0; i < n; i++) if (out[i] !== ref[i]) { first = i; break; }
if (out.length !== ref.length || first >= 0) {
  console.error(`DIFFERENT: ${out.length} bytes vs the packer's ${ref.length}; first difference at ${first}`);
  process.exit(1);
}
console.log(`the same as ${refPath}: ${out.length} bytes`);
