// Blur's PAK2 archives (cache/*.pak): the layout, read from the files and the game's own reader (sub_82921F68 checks
// the magic; the community's blur.bms gave the names' key), checked by decoding every entry of shaders-speed.pak to its
// recorded size.
//
//   0x00  "PAK2", version (1), alignment (0x800), ...; 0x38: the names' size; 0x3C: the names, each byte XORed with
//         the 14-byte key KEY[(i + 1) % 14]: "\path\name.ext\0" ...
//   then, at the next multiple of the alignment: the entry count, the entry table's size, and per entry (32 bytes, big
//   endian): a hash of the name, the name's offset in the names, 0x2000, the uncompressed size, a timestamp (8 bytes),
//   0, the data's offset in units of the alignment.
//   An entry's data: chunks of [BE32 stored size][an XMem LZX buffer (lib/xmem.js), window 128 KB], until the
//   uncompressed size is reached.
//
// The page reads an entry through its record (the release's manifest: the file, the data's offset, the stored bytes,
// codec "xmemchunks"), so it needs only decodeChunks; readPak2 is for the release tools and the tests.

import { xmemDecompress } from './xmem.js';

export const PAK2_WINDOW = 0x20000;  // XMem's default window (128 KB): 34 position slots
export const PAK2_SLOTS = 34;
const KEY = [0x78, 0x56, 0x58, 0x6f, 0x34, 0x30, 0x6a, 0x33, 0x40, 0x24, 0x25, 0x5c, 0x25, 0x60];

function be32(d, o) {
  return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

// An entry's stored bytes ([BE32 n][XMem buffer of n bytes] ...) to its 'size' uncompressed bytes.
export function decodeChunks(stored, size, window = PAK2_WINDOW, slots = PAK2_SLOTS) {
  const out = new Uint8Array(size);
  let p = 0, at = 0;
  // root.pak's form: [BE32 the stored bytes after this word][BE32 the chunk size (64 KB)] before the chunks;
  // shaders-speed.pak's entries start with their first chunk (its stored size, then an XMem frame header).
  const second = stored.length >= 8 ? be32(stored, 4) : 0;
  if (second >= 0x1000 && second <= 0x100000 && (second & (second - 1)) === 0) p = 8;
  while (at < size) {
    if (p + 4 > stored.length) throw new Error(`a PAK2 entry ends after ${at} of its ${size} bytes`);
    const n = be32(stored, p);
    if (p + 4 + n > stored.length) throw new Error('a PAK2 chunk runs past its entry');
    const part = xmemDecompress(stored.subarray(p + 4, p + 4 + n), window, slots);
    if (at + part.length > size) throw new Error(`a PAK2 entry decodes to more than its ${size} bytes`);
    out.set(part, at);
    at += part.length;
    p += 4 + n;
  }
  return { data: out, stored: p };
}

// The entries of a whole PAK2 file (a Uint8Array): [{ name, size, offset, stored(), read() }].
export function readPak2(d) {
  if (d[0] !== 0x50 || d[1] !== 0x41 || d[2] !== 0x4b || d[3] !== 0x32) throw new Error('not a PAK2 archive');
  const align = be32(d, 8);
  const namesSize = be32(d, 0x38);
  const names = new Uint8Array(namesSize);
  for (let i = 0; i < namesSize; i++) names[i] = d[0x3c + i] ^ KEY[(i + 1) % 14];
  const nameAt = (o) => {
    let e = o;
    while (e < names.length && names[e]) e++;
    return new TextDecoder('latin1').decode(names.subarray(o, e));
  };
  const table = Math.ceil((0x3c + namesSize) / align) * align;
  const count = be32(d, table);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const o = table + 8 + i * 32;
    const size = be32(d, o + 12);
    const offset = be32(d, o + 28) * align;
    entries.push({
      name: nameAt(be32(d, o + 4)),
      size,
      offset,
      read() { return decodeChunks(d.subarray(offset), size).data; },
      storedBytes() { return decodeChunks(d.subarray(offset), size).stored; },
    });
  }
  return entries;
}
