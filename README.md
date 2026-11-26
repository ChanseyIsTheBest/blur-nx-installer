# blur-nx-installer

Version 1.0.2, for **blur-nx 1.0.2**: Blur on the Nintendo Switch (homebrew), by ChanseyIsTheBest.

**Open the page: https://chanseyisthebest.github.io/blur-nx-installer/**

This page makes the Switch package from **your own copy** of the game. It runs entirely in your browser: your game files
are not uploaded, and none of the game's files come with blur-nx.

## What you need

- Your **Xbox 360 disc** of Blur as an `.iso` image, or the folder it was extracted to (with `default.xex`, `cache/`,
  `levels/`, `layer1/` and `Ui/`).
- Blur's **title update 2**, the last one: its Xbox 360 package (a LIVE file named like `TU_10LC225_...`), the folder
  that holds it, or the folder it was extracted to (`default.xexp`, `loc.pak`, `gamedata/`, `AvatarAwards`). blur-nx is
  recompiled from the update's code, so the page asks for it.
- A desktop **Chromium browser** (Chrome, Edge, Brave...) and about 6 GB of free disk space for the download. Chrome
  or Edge on a recent graphics card can also re-encode the movies (their H.265 encoder).
- A Switch that runs homebrew (Atmosphère) with **Sphaira**, and an SD card with about 6 GB free.

## How to use it

1. Open the page. To run it on your own computer: `python serve.py 8193 .` in this folder, then open
   http://127.0.0.1:8193/.
2. **Choose your game**: the disc image (`.iso`) or the extracted folder. The page checks that it is the supported version
   and that every file is there.
3. **Add title update 2**: the package, or a folder. The page checks that it is the update blur-nx is made from.
4. Press **Create blur-nx.zip**. The page makes the game's shaders for the Switch from your files (with **Compile the
   shaders** ticked, also compiled for the console, so the game plays without compile stutters), re-encodes the movies
   and the streamed music (the two **Re-encode** options, both recommended), and the zip downloads while it is made;
   keep the page open until it finishes.
5. If you have an older blur-nx, delete its `switch/blur-nx/game_root` folder first: a file of an older zip left next to
   its packed or re-encoded form is read instead of it.
6. Extract `blur-nx.zip` to the **root of the SD card**. It makes `switch/blur-nx/`.
7. On the Switch, open **Sphaira**, find Blur, press **X** to open Options and choose **Install Forwarder**, make sure
   **Address Space** is **39-bit**, choose **Create Forwarder**, then start the game from the **Home Screen**. Start it
   from the forwarder: that is what gives it four CPU cores.

## What goes on the SD card

| Path | What it is |
|---|---|
| `switch/blur-nx/blur-nx.nro` | the program |
| `switch/blur-nx/deko3d_glsl.bin` | the game's 2,544 shaders, translated from your files |
| `switch/blur-nx/deko3d_shaders.bin`, `pipeline_list.bin` | the same compiled for the Switch, and the pipelines the game builds at start (with **Compile the shaders**) |
| `switch/blur-nx/game_root/` | the disc's files, and title update 2's `default.xexp` next to `default.xex` |
| `switch/blur-nx/update/` | title update 2's other files (the game reads them as the console does, from `UPDATE:`) |
| `switch/blur-nx/README.txt` | the player's guide: the settings, the game menu |
| `switch/blur-nx/renut/` | your saves, made by the game (`renut/<profile id>/41560845/00000001/AMAXSAVE/`): copy this folder to back them up |
| `switch/blur-nx/save_backup/` | blur-nx 1.0.2's copy of each save the game wrote (`<profile id>/AMAXSAVE/current`, the one before it in `previous`) |

**Smaller game files** (1.0.1). The level render and physics files are packed with **LZ4 HC level 9 in 256 KB
blocks** and the level streams with **ZXC in 512 KB blocks** (rr6-nx-installer 1.0.1's packing), as `NAME.lz4b`, which
blur-nx reads as the files they were: 3,016 MB to 2,803 MB. The 31 Bink movies are re-encoded to **H.265** with the
browser's video encoder (WebCodecs, about 2.7 Mbit/s) and packed as ZXC blocks (`Ui/movies/NAME.bik.hevc.lz4b`, rr6-nx's
tagged movie format): the Switch's video decoder plays the pictures, and each movie's audio tracks stay the game's own
(1,251 MB to 334 MB). `04_FanTarget.bik` is copied as it is: its frame 321 does not decode in FFmpeg's Bink decoder.
The streamed music and ambience (`cache/root_streaming.pak`) become **Opus at 128 kbit/s** (64 kbit/s for mono), as
`cache/root_streaming.pak.xmop` (sasrt-nx's format; 251 MB to 182 MB). In all, the SD card's game files go from 5.4 GB
to about 4.2 GB.

## Settings

The game writes `switch/blur-nx/blur.toml` at its first start: the language (by default the Switch's), the frame rate
cap, the handheld and docked resolutions, SMAA, MSAA, four-core mode, the button layout and the game menu's look.
Hold **A+B+X+Y+L+R** during the game to open the game menu, where you can change them. Delete the file to get the
defaults back.

## If something goes wrong

- The page says the game is not supported: blur-nx supports one `default.xex`, the one the release's `manifest.json`
  names. It also names any file missing from your copy.
- A crash writes `switch/blur-nx/logs/rex/rex_crash.log`. For a bug report, add `log_level = "info"` at the top of
  `switch/blur-nx/blur.toml`, play until the problem happens, and include the `switch/blur-nx/logs/` folder.

## How it works

The rest of this file is for developers. The page is
[renut_nx_ultimate_installer](https://github.com/ChanseyIsTheBest/renut_nx_ultimate_installer) (the web installer for
ports of [renut_nx_ultimate_base](https://github.com/ChanseyIsTheBest/renut_nx_ultimate_base)) with Blur's `game.json`,
colours and icon, and four things Blur needed:

- **Blur's PAK2 archives** (`lib/pak2.js`, `lib/xmem.js`). 519 of Blur's shaders are in `default.xex`; the other 2,025
  are in `cache/shaders-speed.pak`. A PAK2 file: `PAK2`, version 1, 2 KB alignment; the names XOR'd with a 14-byte key;
  32-byte entries (hash, name offset, size, data offset in alignment units); each entry's data in chunks of a BE32
  stored size and an XMem LZX buffer (128 KB window). `lib/xmem.js` is a port of the XMem LZX decoder blur-nx carries
  (`app/src/blur_lzx_native.cpp`), checked byte for byte against the game's own decodes (`test/xmem_node.mjs`).
- **Split shaders.** Blur registers its shaders with `XGRegister{Vertex,Pixel}Shader`, and its effects keep each
  shader's header and its microcode apart: a record's container has both places (`at`/`length`,
  `phys_at`/`phys_length`), which `lib/sources.js` puts together. `tools/blur_shader_records.mjs` writes the records
  (offsets, sizes and hashes only).
- **The title update** (`lib/stfs.js`, `lib/update.js`): the Xbox 360 package read in the browser (STFS: the file
  table, the block chains through the hash tables), checked by its `default.xexp`'s SHA-256 and its files' sizes
  (`manifest.json`'s `update`, from `tools/make_release.py --update`).
- **The steps' numbers** follow the steps the page shows (`game.json`'s `update`).
- **The movies and the music** (1.0.1): `lib/biks.js` reads Blur's Bink 1 movies, `wasm/bink` (FFmpeg 4.4's Bink
  decoder) decodes their pictures and the browser's H.265 encoder re-encodes them into rr6-nx's tagged format (the video
  data of each Bink frame replaced by a tag; the audio packets kept); `lib/audio.js` and `lib/xmop.js` turn the streamed
  XMA sounds into Opus frames with `wasm/xma`'s decode and the browser's Opus encoder (sasrt-nx-installer's).

The translator (`wasm/renut_hlsl`), uam (`wasm/uam`) and the Python passes (`py/`) are blur-nx's own, so the page's
shaders are the native build's.

## Tests (Node 24, from this folder)

| Test | What it checks |
|---|---|
| `node test/full_node.mjs <game> <out.zip> --update=<update package or folder> [--native-glsl=<blur-nx>/out/deko3d_shaders/glsl_opt] [--reference]` | the whole page in Node: the shaders, the packing, the zip; `--native-glsl` compares the GLSL with the native chain's |
| `python test/check_zip.py <out.zip> <game> <update folder>` | every file of the zip against the original: the LZ4 `.lz4b` ones through the decoder, the ZXC ones through rr6-nx's reader, a re-encoded movie through blur-nx's `bik_hevc_pack.py --check`, the `.xmop` through `test/xmop_check.mjs` |
| `python test/check_release.py [URL]` | every release file the page fetches against the manifest's SHA-256, as git stores it (what Pages serves) or as `URL` serves it: run it before and after every push (`.gitattributes` keeps `release/` byte for byte) |
| `node test/stfs_node.mjs <package> <extracted folder>` | `lib/stfs.js` against another tool's extraction, byte for byte |
| `node test/xmem_node.mjs <dump>` | `lib/xmem.js` against the game's own LZX decodes (blur-nx's `blur_diag_xmem_dump`) |
| `node test/pak2_probe.mjs <pak>`, `node test/pak2_split.mjs <shader dump> <pak>...` | the PAK2 layout, and where each shader's two parts are |
| `test/browser.html` (with `python serve.py 8193 . --test-files <game> --test-packages <update folder> --test-out <zip>`; `?movies=1&audio=1` for the re-encodes, `?compile=0` without the console's shader cache) | `worker.js` in a browser, with no file dialogs |

Outputs of the tests (zips, shader files, dumps) are game data: never commit or share them.

## License

GPL-3.0 (see [LICENSE](LICENSE)). Third-party components are listed in [NOTICES.md](NOTICES.md).

Blur is a trademark of Activision Publishing, Inc.; the icon artwork is © Activision. This project is not affiliated with
or endorsed by Activision, Bizarre Creations, Microsoft or Nintendo.
