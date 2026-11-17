# Themes (worlds)

The 16 official chapters are selected in explicit order by `CHAPTER_FOLDERS` in
`src/web/theme-registry.ts`. This folder contains only official chapter packs.
The original six themes and the blank `_template` now live in `custom-themes/` at the repo root.
They are available under **Custom theme presets** in Theme Editor's **Start from** selector,
with their maps and artwork preserved. Load a preset and choose **Play as custom pack** or
**Export .zip** to use it as a custom theme.
Chapter 1 lives in `chapter-01-workshop` as **Tutorial Workshop** (campaign id `workshop`);
existing `pastel` progress is carried forward. The separate original custom preset remains
**Pastel Plains**. Its files are independent of the official Workshop files.

Chapters 2–16 live in `chapter-NN-concept/`. They include cover art, map colors, badges and
custom level-select layouts, but no placeholder gameplay maps. They appear as **Coming soon**
until maps are added under their `levels/` folder. Chapters 13, 14 and 16 have deliberately
neutral TBD artwork; the other unnamed chapters retain their supplied concept names.
The source for the planned designs is `scripts/make-chapter-themes.ps1`; running it regenerates
their `theme.json` and `cover.svg` files (and overwrites edits to those files).

A custom level pack is the same folder zipped up: make one with **Theme Editor** on the main
menu (*Export .zip*), load it with **Load pack (.zip)** on the world screen. To turn a custom
pack into an official world, unzip it into a folder here and register it in `CHAPTER_FOLDERS`.

```
themes/07-my-world/
  theme.json        the world's info and look (below)
  cover.png         representative image, shown on the world tile   (any name; see "cover")
  badge.png         picture behind the level number                 (optional; see "style.badge.image")
  levels/
    01.json         levels in file-name order, at most 21
    02.json         (maps exported from the Map Editor with "Export JSON")
    …
```

Images can be `.png`, `.jpg`, `.webp`, `.gif` or `.svg`.

## theme.json

| Field | Meaning |
|---|---|
| `format` | Always `1` |
| `id` | Unique id; progress is saved under it. Letters, digits, `-`, `_` |
| `name` | World name |
| `description` | A sentence or two about the world |
| `author` | Who made it |
| `authorUrl` | Link to the author (optional) |
| `released` | Release date, `YYYY-MM-DD` |
| `unlockStars` | Stars (over all official worlds) needed to play it. `0` = open from the start |
| `colors` | Two colors, `["#rrggbb", "#rrggbb"]`: the world tile's gradient |
| `cover` | File name of the representative image (optional) |
| `music` | Relative audio path inside the pack, e.g. `audio/background.mp3` (optional) |
| `style.maze` | Maze colors for levels without their own theme: `{ "wall": …, "path": … }`, the same format as a map's `theme` (easiest to make in the Theme Editor) |
| `style.cursorColor` | Cursor color for levels without their own (optional) |
| `style.badge` | The in-game level number / title badge (below) |

### Background music

In **Theme Editor → Background music**, choose an MP3, OGG, WAV, M4A, AAC or FLAC file
(up to 20 MB). Use **Preview music**, **Stop**, or **Remove music** to manage it.
The music loops through level selection and gameplay without restarting between levels.
Master and background-music volume apply to preview and gameplay. Formats must be supported
by the player's browser. Themes without a music file are silent.

Music is included in theme ZIP import/export. For official or bundled custom themes, place
the audio file inside that theme's folder and set `"music": "audio/background.mp3"` in
`theme.json`. Large audio may exceed browser draft/custom-pack localStorage capacity;
the editor reports this and the current pack can still be exported to ZIP (30 MB import limit).

For menu music, use **Options → Main menu music** (saved locally in this browser), or add
`src/assets/music/main-menu.mp3` to bundle a default for everyone. **Reset music** removes
the local override. Playback begins after the first interaction and pauses in hidden tabs.

### Maze patterns

Maze surface fills support these pattern ids: `stripes`, `diagonal`, `dots`, `grid`,
`checker`, `wood` (staggered planks and grain), `grass` (grass blades), `sand`
(grains and ripples), and `metal` (brushed panels and rivets). In the editor, choose
**Pattern** as the fill type, then select the material. All patterns use the chosen
`color`, `background`, and tile `size` (4–64 pixels), for both walls and paths.

### style.badge

| Field | Meaning |
|---|---|
| `kind` | `pill` rounded plate · `disc` vinyl record · `emblem` snowflake emblem · `plate` gear plate · `slant` slanted band · `ring` wood slice · `image` your own picture |
| `primary`, `secondary` | Main and second color of the design |
| `numberColor`, `titleColor` | Colors of the level number and title |
| `font` | `title`, `main`, `serif`, `heavy`, `timer`, or a library font id (see *Custom screens and fonts*) |
| `pad` | Zero-pad the number: `0` → `7`, `2` → `07`, `3` → `007` |
| `showTitle` | Show the level title next to the number |
| `caption` | Small text above the title, e.g. `"♫ Now Playing"` (optional) |
| `image` | File name of the picture for `kind: "image"` (optional) |

## Levels

Each level is a normal map file. Fields that matter for worlds (all set in the Map Editor under
**Level settings**):

- `title`, `level` — shown in the badge (the level number defaults to its position)
- `difficulty` — 1.00 to 10.00, shown on level select; the world's average is shown on its tile
  (levels without one count as 1.00)
- `stars` — clear times for 3 / 2 / 1 stars; a level without them gives 3 stars for any clear

## Custom screens and fonts

A theme can replace the level select screen (`screens.select`) on a 1280×720 stage. Design it in the **Theme Editor** (*Level select* tab); the format is written into theme.json. Levels start directly after selection.

- `screens.<name>.background`: `color`, optional `color2` (gradient), `image` (file), `fit`
  (`cover` / `contain` / `tile`), `dim` (0–0.9)
- `screens.<name>.elements`: `text`, `image`, `box`, `levelGrid` (level buttons; pages through
  packs with more levels than cells), `back`, `stars`, `progress`. Each has `x`, `y`, `w`, `h`, optional `rotate`, `opacity` and `when`
  (`allComplete`, `notComplete`, `cleared`, `notCleared`).
- Text placeholders: `{theme}`, `{description}`, `{author}`, `{credits}`, `{released}`,
  `{cleared}`, `{total}`, `{stars}`, `{maxStars}`.
- `credits`: free text shown with `{credits}` (designers, music, …).
- `fonts`: `[{ "family": "LCD", "file": "fonts/lcd.ttf" }]` — font files in the pack, picked by
  `family` for texts and level buttons. Built-in fonts: `title`, `main`, `serif`, `heavy`,
  `condensed`, `digital`, `hand`, `blackletter`, `mono`.
- Library fonts: the fonts in `src/assets/fonts/etc` can be used by id anywhere a font is picked
  (texts, level buttons, `style.badge.font`), e.g. `"font": "paperlogy-bold"`. The ids, copyrights
  and licenses are listed in `src/assets/fonts/LICENSES.md` and in-game under
  **Options → Font licenses**. Fonts whose license isn't stated in the file are marked ⓘ in the pickers.

Official themes have 21 level slots. Custom packs can hold any number of levels.
