// blur-nx (2026-11-18): where the page finds Blur's shaders outside default.xex: the entries of cache/shaders-speed.pak
// (PAK2, lib/pak2.js) that hold them, as records for tools/make_release.py --records. Blur registers its shaders with
// XGRegister{Vertex,Pixel}Shader, and its .fxb effects keep each shader's header (with its virtual data) and its
// microcode apart in the same entry: a container is listed with both places (at/length, phys_at/phys_length), which the
// page puts together (lib/sources.js containerOf). Measured on Blur's disc: all 2,025 of the dump's shaders that are not
// in default.xex are in shaders-speed.pak this way. Writes offsets, sizes and hashes only (no game bytes).
//   node tools/blur_shader_records.mjs <game folder> <port's out/renut_shader_dump> <out.json>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readPak2 } from '../lib/pak2.js';

const [game, dumpDir, outPath] = process.argv.slice(2);
const PAKS = ['cache/shaders-speed.pak'];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaders = [];
for (const n of readdirSync(dumpDir)) {
  if (!/^(vs|ps)_[0-9a-f]{16}\.bin$/.test(n)) continue;
  const b = readFileSync(join(dumpDir, n));
  const virt = b.readUInt32BE(4);
  shaders.push({ n, sha256: sha(b), virt: b.subarray(0, virt), phys: b.subarray(virt) });
}
const placed = new Set();
const records = [];
for (const rel of PAKS) {
  const pak = readFileSync(join(game, rel));
  for (const e of readPak2(pak)) {
    const { data, stored } = (() => {
      const r = e.read();
      return { data: Buffer.from(r), stored: e.storedBytes() };
    })();
    const containers = [];
    for (const s of shaders) {
      if (placed.has(s.sha256)) continue;
      const at = data.indexOf(s.virt);
      if (at < 0) continue;
      const physAt = data.indexOf(s.phys);
      if (physAt < 0) continue;
      placed.add(s.sha256);
      containers.push({ at, length: s.virt.length, phys_at: physAt, phys_length: s.phys.length, sha256: s.sha256 });
    }
    if (containers.length) {
      records.push({ file: rel, offset: e.offset, stored, size: e.size, codec: 'xmemchunks', containers });
    }
  }
}
writeFileSync(outPath, JSON.stringify({ files: records }, null, 1));
console.log(`${shaders.length} shaders in the dump: ${placed.size} placed in ${records.length} records of ${PAKS.join(', ')}; ` +
            `the rest must be in default.xex (make_release.py checks)`);
