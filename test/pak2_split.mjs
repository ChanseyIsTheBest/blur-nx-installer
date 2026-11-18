// Blur registers shaders with XGRegister{Vertex,Pixel}Shader: the container Renut names (header + virtual data, then the
// physical microcode) is put together from two places in memory. Are the two parts of each dumped shader (game data:
// local only) in the decoded entries of the given PAK2 files, each whole, in the same entry? Tests only; writes nothing.
//   node test/pak2_split.mjs <shader dump folder> <pak> [<pak> ...]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readPak2 } from '../lib/pak2.js';

const dumpDir = process.argv[2];
const shaders = [];
for (const n of readdirSync(dumpDir)) {
  if (!/^(vs|ps)_[0-9a-f]{16}\.bin$/.test(n)) continue;
  const b = readFileSync(join(dumpDir, n));
  const virt = b.readUInt32BE(4);
  shaders.push({ n, virt: b.subarray(0, virt), phys: b.subarray(virt) });
}
const entries = [];
for (const p of process.argv.slice(3)) {
  for (const e of readPak2(readFileSync(p))) {
    try { entries.push({ name: e.name, d: Buffer.from(e.read()) }); } catch { /* not this codec */ }
  }
}
let both = 0, virtOnly = 0, physOnly = 0, none = 0, apart = 0;
for (const s of shaders) {
  let best = 0;
  for (const { d } of entries) {
    const v = d.indexOf(s.virt) >= 0, ph = d.indexOf(s.phys) >= 0;
    const score = v && ph ? 3 : v ? 2 : ph ? 1 : 0;
    if (score > best) best = score;
    if (best === 3) break;
  }
  if (best === 3) both++;
  else if (best === 2) virtOnly++;
  else if (best === 1) physOnly++;
  else none++;
}
console.log(`${shaders.length} dumped shaders in ${entries.length} decoded entries: header and microcode in one entry ${both}, ` +
            `header only ${virtOnly}, microcode only ${physOnly}, neither ${none}`);
