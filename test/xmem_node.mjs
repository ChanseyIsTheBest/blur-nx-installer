// lib/xmem.js against the game's own decodes: blur-nx's blur_diag_xmem_dump writes each shader-holding LZX buffer the
// game decoded (<n>.in, <n>.out, and index.txt: n, sizes, window, slots). Every buffer is decoded here and compared
// byte for byte with the game's output. The dump is game data: it stays where it was made.
//   node test/xmem_node.mjs <dump folder>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { xmemDecompress } from '../lib/xmem.js';

const dir = process.argv[2];
const lines = readFileSync(join(dir, 'index.txt'), 'utf8').trim().split(/\r?\n/);
let same = 0, differ = 0, failed = 0, bytes = 0;
const t0 = Date.now();
for (const line of lines) {
  const [n, inSize, outSize, window, slots] = line.split(' ').map(Number);
  const src = readFileSync(join(dir, `${n}.in`));
  const want = readFileSync(join(dir, `${n}.out`));
  if (src.length !== inSize || want.length !== outSize) {
    console.log(`#${n}: the dump's sizes do not match its index`);
    failed++;
    continue;
  }
  try {
    const got = xmemDecompress(new Uint8Array(src), window, slots, outSize);
    if (Buffer.compare(Buffer.from(got), want) === 0) {
      same++;
      bytes += outSize;
    } else {
      let at = 0;
      while (at < got.length && got[at] === want[at]) at++;
      console.log(`#${n}: differs from byte ${at} (frame ${Math.floor(at / 0x8000)}), window ${window}, slots ${slots}`);
      differ++;
    }
  } catch (e) {
    console.log(`#${n}: ${e.message}`);
    failed++;
  }
}
console.log(`${lines.length} buffers: ${same} the same (${(bytes / 1048576).toFixed(1)} MB), ${differ} differ, ${failed} failed; ` +
            `${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(differ || failed ? 1 : 0);
