// blur-nx-installer 1.0.1: wasm/bink (FFmpeg 4.4's Bink decoder) against a native ffmpeg's decode of the same movie:
// the first N frames' pictures, I420, compared byte for byte (and their PSNR when they differ).
//   node test/bink_wasm_node.mjs IN.bik [FRAMES] [FFMPEG]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { binkVideo } from '../lib/biks.js';

const [path, count = '60', ffmpeg = 'C:/ffmpeg/ffmpeg.exe'] = process.argv.slice(2);
if (!path) {
  console.error('usage: node test/bink_wasm_node.mjs IN.bik [FRAMES] [FFMPEG]');
  process.exit(2);
}
const { default: createBinkModule } = await import('../wasm/bink.mjs');
const bink = await createBinkModule({ print: () => {}, printErr: () => {} });
const bytes = new Uint8Array(readFileSync(path));
const movie = binkVideo(bytes);
const n = Math.min(Number(count), movie.vids.length);
const frameBytes = movie.width * movie.height * 3 / 2;
const ref = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path, '-map', '0:v:0', '-frames:v', String(n),
                               '-pix_fmt', 'yuv420p', '-f', 'rawvideo', '-'], { maxBuffer: frameBytes * n + 1024 });
if (ref.status !== 0) throw new Error(`ffmpeg: ${ref.stderr}`);
if (ref.stdout.length !== frameBytes * n) throw new Error(`ffmpeg gave ${ref.stdout.length} bytes for ${n} frames`);
console.log(`wasm/bink: libavcodec ${bink._bink_version() >> 16}.${(bink._bink_version() >> 8) & 255}; ${path}: ` +
            `${movie.width}x${movie.height}, ${n} frames`);
if (bink._bink_open(movie.width, movie.height, movie.tag, movie.flags) < 0) throw new Error('bink_open failed');
const input = bink._bink_malloc(4 << 20);
let same = 0, worst = 99;
const t0 = performance.now();
for (let k = 0; k < n; k++) {
  const [a, b] = movie.vids[k];
  if (b - a > 4 << 20) throw new Error(`frame ${k}: ${b - a} bytes`);
  bink.HEAPU8.set(bytes.subarray(a, b), input);
  const r = bink._bink_decode(input, b - a);
  if (r !== 1) throw new Error(`frame ${k}: bink_decode ${r}`);
  const p = bink._bink_picture();
  const got = bink.HEAPU8.subarray(p, p + frameBytes), want = ref.stdout.subarray(k * frameBytes, (k + 1) * frameBytes);
  if (Buffer.compare(Buffer.from(got.buffer, got.byteOffset, got.length), want) === 0) { same++; continue; }
  let e = 0;
  for (let i = 0; i < frameBytes; i++) e += (got[i] - want[i]) ** 2;
  const psnr = 10 * Math.log10(255 * 255 / (e / frameBytes));
  worst = Math.min(worst, psnr);
  if (n - same <= 3) console.log(`  frame ${k}: differs, PSNR ${psnr.toFixed(2)} dB`);
}
const s = (performance.now() - t0) / 1000;
bink._bink_free(input);
bink._bink_close();
console.log(`${same} of ${n} frames the same as ffmpeg's` + (same < n ? `; the worst PSNR ${worst.toFixed(2)} dB` : '') +
            `; ${(n / s).toFixed(0)} frames a second`);
process.exit(same === n ? 0 : 1);
