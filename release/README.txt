blur-nx: Blur (Bizarre Creations, 2010; Xbox 360, title 41560845) on the Nintendo Switch
=========================================================================================

A ReXGlue static recompilation, built from renut_nx_ultimate_base (banjo-nx's SDK fork, its post-codegen CPU passes
and the ports' fixes) with reNut's Direct3D-level renderer on plume's deko3d back end (no NVK, no PM4 ring, no EDRAM
model). Your own game files are needed; nothing of the game is in this package except the recompiled code.

Install it with the web installer (https://chanseyisthebest.github.io/blur-nx-installer/): it makes blur-nx.zip from
your disc and title update 2, in your browser. Extract the zip to the root of the SD card, then in Sphaira
find Blur, press X, choose Install Forwarder, set Address Space to 39-bit, choose Create Forwarder, and start the game
from the Home Screen.

Credits: reNut's renderer by masterspike52 (its author permits its reuse in these ports), renut_nx_ultimate_base and
the ports its fixes come from (katamari-nx, banjo-nx, sa2-nx, rr6-nx, sasrt-nx, kameo-nx and the others),
NetherSX2_nx by NaGaa95 (the four-core layout, MIT), battd_nx (the GPU arena), bejeweled3-nx and the zuma ports (the
hot-function method). GPL-3.0 where the sources are.

SD card layout
--------------
sdmc:/switch/blur-nx/blur-nx.nro        the program
sdmc:/switch/blur-nx/deko3d_glsl.bin    the game's shaders, made by the installer from your files
sdmc:/switch/blur-nx/deko3d_shaders.bin the same compiled for the Switch, and pipeline_list.bin, the pipelines the game
                                        builds at start (the installer's "Compile the shaders" option)
sdmc:/switch/blur-nx/blur.toml          your settings (fourteen of them; written at the first start, see "Settings")
sdmc:/switch/blur-nx/game_root/         the disc's files: default.xex and the rest of the disc (the ISO itself is not
                                        read). Title update 2's default.xexp goes next to default.xex. The level
                                        files are packed (NAME.lz4b), the movies re-encoded to H.265 for the
                                        Switch's video decoder (Ui/movies/NAME.bik.hevc.lz4b) and the streamed music
                                        and ambience to Opus (cache/root_streaming.pak.xmop); the game reads each as
                                        NAME. A plain NAME next to its packed form is read instead, so delete an
                                        older blur-nx's game_root before extracting a new zip.
sdmc:/switch/blur-nx/update/            title update 2's other files (mounted as UPDATE:, as the console does)
sdmc:/switch/blur-nx/renut/             your saves: renut/<profile id>/41560845/00000001/AMAXSAVE/savegame (copy the
                                        whole renut folder to back them up). A save is set aside while the game
                                        writes it again and put back by itself if the game closes in between.
sdmc:/switch/blur-nx/save_backup/       a copy of each save the game wrote: <profile id>/AMAXSAVE/current, and the
                                        one before it in previous. To go back to one, copy its files into the save's
                                        folder above.
sdmc:/switch/blur-nx/logs/              logs: none in normal play; logs/rex/rex_crash.log after a crash

Bug reports: add log_level = "info" at the top of blur.toml, play until the problem happens, and include the logs/
folder.

Settings
--------
The build has every setting built in but fourteen, which are in blur.toml next to the NRO (written at the first start;
delete it to get the defaults back): language ("System", the console's own, by default), the frame rate cap (30),
the handheld and docked resolutions of the 3D image (720 and 972 lines), SMAA (on), MSAA (off), four-core mode (on:
highly recommended to leave on), the Xbox button layout, the two sideways Joy-Con options, and the buttons that open
the game menu (input_menu_combo, "A+B+X+Y+L+R": any two or more Switch buttons joined by +), and the menu's colour
(menu_color: Green, Yellow, Red, Blue, Purple, Pink, Orange, White or Rainbow), font (menu_font: System, Pixel,
Roboto, Karla or Cousine) and background (menu_background_opacity: 0-100 % solid, 80 by default).

The game menu: hold A+B+X+Y+L+R together during the game (L and R first; or the buttons input_menu_combo names). Up/Down choose, Left/Right change, L/R switch tabs, and +
closes it; the game takes no input while it is up. Tabs: Settings (the fourteen, and rumble), Achievements (the game's own
list, names, gamerscores and images, read from your default.xex), and P1-P4 Controls (the Switch button that presses
each Xbox 360 button, per player). Settings marked * (language, four-core mode) take effect at the next start; the
resolutions and MSAA when the menu closes; the others at once. The menu writes your changes into blur.toml when it
closes.

Test settings: any key of a full toml (the repository's dist/switch/blur-nx/renut.toml and configs/) copied into
blur.toml overrides the built-in one. The test builds (BLUR_BUILTIN_CONFIG=OFF) read a full renut.toml instead.

A console profile
-----------------
Add switch_profile_stacks = true and log_level = "info" to blur.toml (configs/renut_profile.toml): the sampler writes
sdmc:/switch/blur-nx/logs/rex/rex_profile.log, one report every 10 s. Play a few minutes of a race, then send that
file and logs/renut_001.log. With the ELF of this NRO's build (below) the samples map to functions:
the machine copies (tools/switch_hot_bulk.py --merge) and any hand-written native are made from it.

Cores
-----
The port runs on four cores (four_core_mode, on by default) when launched from its Sphaira forwarder (05A5D8E1BAA3E000, the forwarder of
sdmc:/switch/blur-nx/blur-nx.nro): the NRO writes that forwarder's four-core NPDM
(NetherSX2_nx's layout, CPU 0-3) to sdmc:/atmosphere/contents/<id>/exefs/main.npdm at the next start. Delete that
main.npdm, or set four_core_mode = false (the game removes the file it wrote), to go back to three cores.

Profiling files
---------------
The samples map to functions with the ELF of the same build: build the release's commit from source
(https://github.com/ChanseyIsTheBest/blur-nx, docs/building.md).
