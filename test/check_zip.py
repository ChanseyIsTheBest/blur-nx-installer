#!/usr/bin/env python3
"""renut_nx_ultimate_installer: checks a zip the page (or test/full_node.mjs) made against the game folder it was made
from, game.json and release/: the zip's CRCs, the NRO and every release file by the manifest's SHA-256, the shader files
(against the build's reference SHA-256 when the manifest has them), every game_root file byte for byte (the ones
game.json "skip" names left out), and every .lz4b entry's blocks decompressed and compared with the original.

  python test/check_zip.py <zip> <game folder>

Needs the lz4 module (pip's lz4). Game data: never commit or share the zip.
blur-nx (2026-11-18): with a third argument, the title update's extracted folder (when the build names one): its
default.xexp in game_root/ and its other files in update/, each the update's own.
  python test/check_zip.py <zip> <game folder> [<title update folder>]
blur-nx-installer 1.0.1 (2026-11-24, as sasrt-nx-installer's check, credit it and rr6-nx-installer): game.json "zxc"
files are version-2 (ZXC) entries, written to a temporary file and read through rr6-nx's own reader by its host test
(RR6_LZ4B_TEST, default D:/ridge racer 6/rr6-nx/out/test_lz4_blocks.exe: the whole file and 2,000 random reads; Blur's
reader is rr6-nx 1.0.1's); a "movies" file the page re-encoded is NAME.hevc.lz4b (ZXC), unpacked (BLUR_ZXC_UNPACK,
blur-nx's zxc_unpack_file.mjs) and checked by blur-nx's tools/bik_hevc_pack.py --check (BLUR_BIK_CHECK: every byte
outside the video data as in the .bik, every tag, the frame count) when those are there, else only found; the "audio"
file the page re-encoded is NAME.xmop, checked by test/xmop_check.mjs.
"""
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

import lz4.block

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
READER_TEST = os.environ.get('RR6_LZ4B_TEST', r'D:/ridge racer 6/rr6-nx/out/test_lz4_blocks.exe')
ZXC_UNPACK = os.environ.get('BLUR_ZXC_UNPACK', r'D:/blur/scratch_scripts_1120/zxc_check/zxc_unpack_file.mjs')
BIK_CHECK = os.environ.get('BLUR_BIK_CHECK', r'D:/blur/blur-nx/tools/bik_hevc_pack.py')


def file_sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for piece in iter(lambda: f.read(1 << 20), b''):
            h.update(piece)
    return h.hexdigest()


def entry_sha(z, name):
    h = hashlib.sha256()
    with z.open(name) as f:
        for piece in iter(lambda: f.read(1 << 20), b''):
            h.update(piece)
    return h.hexdigest()


def check_lz4b(z, info, original):
    with z.open(info) as f:
        magic, version, block, size, count, _ = struct.unpack('<8sIIQII', f.read(32))
        assert magic == b'RXLZ4BLK' and version == 1, 'header'
        assert size == os.path.getsize(original), f'holds {size} bytes, the original has {os.path.getsize(original)}'
        f.seek(info.file_size - 16)
        index_offset, end = struct.unpack('<Q8s', f.read(16))
        assert end == b'RXLZ4END', 'footer'
        f.seek(index_offset)
        sizes = struct.unpack(f'<{count}I', f.read(4 * count))
        assert 32 + sum(sizes) == index_offset, 'index'
        f.seek(32)
        with open(original, 'rb') as o:
            for i, stored in enumerate(sizes):
                length = block if i + 1 < count else size - i * block
                data = f.read(stored)
                raw = data if stored == length else lz4.block.decompress(data, uncompressed_size=length)
                if raw != o.read(length):
                    raise AssertionError(f'block {i} differs')
    return size, info.file_size, count


def entry_to_temp(z, entry, suffix):
    fd, temp = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, 'wb') as out, z.open(entry) as f:
        shutil.copyfileobj(f, out, 1 << 20)
    return temp


def check_zxc(z, info, original):
    """A version-2 entry through rr6-nx's reader: the whole file and 2,000 random reads compared with the original."""
    with z.open(info) as f:
        magic, version, block, size, count, _ = struct.unpack('<8sIIQII', f.read(32))
    assert magic == b'RXLZ4BLK' and version == 2, 'header'
    assert size == os.path.getsize(original), f'holds {size} bytes, the original has {os.path.getsize(original)}'
    temp = entry_to_temp(z, info, '.lz4b')
    try:
        env = dict(os.environ)
        clang64 = r'C:/devkitPro/msys2/clang64/bin'
        if os.path.isdir(clang64):
            env['PATH'] = clang64 + os.pathsep + env.get('PATH', '')
        r = subprocess.run([READER_TEST, temp, original, '2000'], capture_output=True, text=True, env=env)
        if r.returncode != 0 or not r.stdout.startswith('OK'):
            raise AssertionError('rr6-nx reader: ' + (r.stdout + r.stderr).strip()[-300:])
    finally:
        os.remove(temp)
    return size, info.file_size, count


def check_movie(z, entry, original):
    """NAME.hevc.lz4b: unpacked, then bik_hevc_pack.py --check against NAME. Returns what was checked (only found when
    the tools are not here); raises AssertionError when it fails."""
    if not (os.path.exists(ZXC_UNPACK) and os.path.exists(BIK_CHECK)):
        return 'found (no deep check here)'
    packed = entry_to_temp(z, entry, '.lz4b')
    fd, plain = tempfile.mkstemp(suffix='.bik.hevc')
    os.close(fd)
    try:
        r = subprocess.run(['node', ZXC_UNPACK, packed, plain], capture_output=True, text=True)
        if r.returncode or not r.stdout.startswith('OK'):
            raise AssertionError('unpack: ' + (r.stdout + r.stderr).strip()[-300:])
        r = subprocess.run([sys.executable, '-P', BIK_CHECK, '--check', original, plain], capture_output=True, text=True)
        out = r.stdout + r.stderr
        frames = re.search(r'frames: Bink (\d+), H\.265 (\d+)', out)
        clean = re.search(r'bytes outside the video data that differ: 0; frames: \d+, tags not where they should be: 0, '
                          r'video data not zero after the tag: 0', out)
        if r.returncode or not frames or frames.group(1) != frames.group(2) or frames.group(1) == '0' or not clean:
            raise AssertionError('bik_hevc_pack.py --check: ' + ' '.join(out.split())[-400:])
        psnr = re.search(r'PSNR[^\n]*', out)
        return f'{frames.group(1)} frames, checked' + (f'; {psnr.group(0)[:80]}' if psnr else '')
    finally:
        os.remove(packed)
        os.remove(plain)


def main():
    zip_path, game = sys.argv[1], sys.argv[2]
    update = sys.argv[3] if len(sys.argv) > 3 else None
    cfg = json.load(open(os.path.join(HERE, 'game.json'), encoding='utf-8'))
    manifest = json.load(open(os.path.join(HERE, 'release', 'manifest.json'), encoding='utf-8'))
    xex_sha = file_sha(os.path.join(game, 'default.xex'))
    build = next(b for b in manifest['builds'] if b['xex_sha256'] == xex_sha)
    root = f'switch/{cfg["package"]}/'
    lz4_res = [re.compile(f'^(?:{p})$', re.I) for p in cfg.get('lz4', [])]
    zxc_res = [re.compile(f'^(?:{p})$', re.I) for p in cfg.get('zxc', [])]
    movie_res = [re.compile(f'^(?:{p})$', re.I) for p in cfg.get('movies', [])]
    audio_res = [re.compile(f'^(?:{cfg["audio"]["match"]})$', re.I)] if cfg.get('audio') else []
    skip_res = [re.compile(f'^(?:{p})$', re.I) for p in cfg.get('skip', [])]
    with zipfile.ZipFile(zip_path) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f'FAIL: {bad} has a wrong CRC')
        names = set(i.filename for i in z.infolist())
        print(f'{len(names)} entries, all CRCs right')
        release = {root + cfg['nro']: build['nro_sha256'], **{root + f['path']: f['sha256'] for f in build['files']
                                                              if not f.get('with_cache') or root + f['path'] in names}}
        for name, want in release.items():
            if entry_sha(z, name) != want:
                raise SystemExit(f'FAIL: {name} is not the release file')
        print(f'release files: {len(release)} as the manifest names them')
        if cfg.get('shaders'):
            for name, key in (('deko3d_glsl.bin', 'deko3d_glsl_sha256'), ('deko3d_shaders.bin', 'deko3d_shaders_sha256')):
                if root + name not in names:
                    if name == 'deko3d_glsl.bin':
                        raise SystemExit('FAIL: no deko3d_glsl.bin')
                    print(f'{name}: not in the zip (made without the cache)')
                    continue
                got = entry_sha(z, root + name)
                want = build.get(key)
                print(f'{name}: {z.getinfo(root + name).file_size:,} bytes' +
                      ('' if not want else ', the reference build\'s' if got == want else ' (not the reference build\'s)'))
                if want and got != want:
                    raise SystemExit(f'FAIL: {name} differs from the reference')
        placed = set()  # the title update's entries, which the game folder's "skip" does not concern
        if build.get('update'):
            if not update:
                raise SystemExit('FAIL: the build names a title update: pass its extracted folder as the third argument')
            want = {'default.xexp': root + 'game_root/default.xexp',
                    **{p: root + 'update/' + p for p in build['update']['files']}}
            for rel, entry in want.items():
                if entry not in names:
                    raise SystemExit(f'FAIL: no {entry} (the title update file {rel})')
                if entry_sha(z, entry) != file_sha(os.path.join(update, rel)):
                    raise SystemExit(f'FAIL: {entry} is not the title update file {rel}')
                placed.add(entry)
            print(f'title update: {len(want)} files right (default.xexp in game_root/, {len(want) - 1} in update/)')
        count = packed_in = packed_out = 0
        movies_in = movies_out = audio_in = audio_out = 0
        for dirpath, _, files in os.walk(game):
            for f in sorted(files):
                original = os.path.join(dirpath, f)
                rel = os.path.relpath(original, game).replace(os.sep, '/')
                if any(r.match(rel) for r in skip_res):
                    if root + 'game_root/' + rel in names and root + 'game_root/' + rel not in placed:
                        raise SystemExit(f'FAIL: {rel} should have been left out')
                    continue
                count += 1
                entry = root + 'game_root/' + rel
                if any(r.match(rel) for r in movie_res) and entry + '.hevc.lz4b' in names:
                    if entry in names:
                        raise SystemExit(f'FAIL: {rel} is in the zip both re-encoded and as it is')
                    try:
                        how = check_movie(z, entry + '.hevc.lz4b', original)
                    except AssertionError as e:
                        raise SystemExit(f'FAIL: {entry}.hevc.lz4b: {e}')
                    size = z.getinfo(entry + '.hevc.lz4b').file_size
                    movies_in += os.path.getsize(original)
                    movies_out += size
                    print(f'{entry}.hevc.lz4b: {how} ({size / os.path.getsize(original) * 100:.1f} %)')
                elif any(r.match(rel) for r in audio_res) and entry + '.xmop' in names:
                    if entry in names:
                        raise SystemExit(f'FAIL: {rel} is in the zip both re-encoded and as it is')
                    temp = entry_to_temp(z, entry + '.xmop', '.xmop')
                    try:
                        r = subprocess.run(['node', os.path.join(HERE, 'test', 'xmop_check.mjs'), original, temp],
                                           capture_output=True, text=True)
                    finally:
                        os.remove(temp)
                    if r.returncode:
                        raise SystemExit(f'FAIL: {entry}.xmop: {r.stdout.strip()[-300:]}')
                    size = z.getinfo(entry + '.xmop').file_size
                    audio_in += os.path.getsize(original)
                    audio_out += size
                    tail = ' '.join(r.stdout.split())[-160:]
                    print(f'{entry}.xmop: checked ({size / os.path.getsize(original) * 100:.1f} %): {tail}')
                elif any(r.match(rel) for r in lz4_res + zxc_res):
                    if entry in names:
                        raise SystemExit(f'FAIL: {rel} is in the zip unpacked too')
                    codec = 'lz4' if any(r.match(rel) for r in lz4_res) else 'zxc'
                    check = check_lz4b if codec == 'lz4' else check_zxc
                    try:
                        size, packed, blocks = check(z, z.getinfo(entry + '.lz4b'), original)
                    except AssertionError as e:
                        raise SystemExit(f'FAIL: {entry}.lz4b: {e}')
                    packed_in += size
                    packed_out += packed
                    print(f'{entry}.lz4b ({codec}): {blocks} blocks equal {rel} ({packed / size * 100:.1f} %)')
                elif entry_sha(z, entry) != file_sha(original):
                    raise SystemExit(f'FAIL: {entry} differs from {rel}')
        print(f'game_root: {count} files right' +
              (f'; packed {packed_in / 1048576:.0f} MB -> {packed_out / 1048576:.0f} MB' if packed_in else '') +
              (f'; movies {movies_in / 1048576:.0f} MB -> {movies_out / 1048576:.0f} MB' if movies_in else '') +
              (f'; audio {audio_in / 1048576:.0f} MB -> {audio_out / 1048576:.0f} MB' if audio_in else ''))
    print('OK')


if __name__ == '__main__':
    main()
