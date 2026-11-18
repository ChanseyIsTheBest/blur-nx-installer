// Probe of Blur's PAK2 layout (tests only; reads the player's own pak, writes nothing): the names (XOR, 14-byte key), the
// entry table, and each entry's data as [BE32 stored size][XMem LZX buffer] chunks, decoded with lib/xmem.js; counts the
// shader containers in the decoded entries.
//   node test/pak2_probe.mjs <pak> [window bits]
import { readFileSync } from 'node:fs';
import { xmemDecompress } from '../lib/xmem.js';

const d = readFileSync(process.argv[2]);
const bits = Number(process.argv[3] || 17);
const SLOTS = { 15: 30, 16: 32, 17: 34, 18: 36, 19: 38, 20: 42, 21: 50 };
const be32 = (o) => d.readUInt32BE(o);
const KEY = Buffer.from('xVXo40j3@$%\\%`', 'latin1');
const nsize = be32(0x38);
const names = Buffer.from(d.subarray(0x3c, 0x3c + nsize).map((b, i) => b ^ KEY[(i + 1) % 14]));
const nameAt = (o) => names.subarray(o, names.indexOf(0, o)).toString("latin1");
let tab = Math.ceil((0x3c + nsize) / 0x800) * 0x800;
const count = be32(tab);
const tableBytes = be32(tab + 4);
const entries = [];
for (let i = 0; i < count; i++) {
  const o = tab + 8 + i * 32;
  // [hash][name offset][0x2000][size][timestamp (8)][0][data offset in sectors of the header's alignment]
  entries.push({ hash: be32(o), name: nameAt(be32(o + 4)), unk: be32(o + 8), size: be32(o + 12),
                 at: be32(o + 28) * be32(8) });
}
console.log(`${count} entries, table ${tableBytes} bytes; first: ${entries[0].name} at 0x${entries[0].at.toString(16)}`);
let ok = 0, bad = 0, shaders = 0, stored = 0;
for (const [i, e] of entries.entries()) {
  const at = e.at;
  if (i < 3) console.log(i, e.name, 'size', e.size, 'unk', e.unk.toString(16), 'at', at.toString(16));
  let p = at, out = 0;
  try {
    const parts = [];
    while (out < e.size) {
      const n = be32(p);
      const buf = xmemDecompress(new Uint8Array(d.subarray(p + 4, p + 4 + n)), 1 << bits, SLOTS[bits]);
      parts.push(buf);
      out += buf.length;
      p += 4 + n;
    }
    if (out !== e.size) throw new Error(`decoded ${out} of ${e.size}`);
    ok++;
    stored += p - at;
    const all = Buffer.concat(parts.map((x) => Buffer.from(x)));
    for (let k = 0; k + 3 <= all.length; k += 4) if (all[k] === 0x10 && all[k + 1] === 0x2a && all[k + 2] === 0x11) shaders++;
  } catch (err) {
    bad++;
    if (bad <= 5) console.log(`entry ${i} ${e.name} at 0x${at.toString(16)}: ${err.message}`);
  }
  if (bad > 20) break;
}
console.log(`decoded ${ok}, failed ${bad}; ${stored} bytes stored; shader headers in the decoded entries: ${shaders}`);
