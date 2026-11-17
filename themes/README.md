# Themes (worlds)

Every folder here is one official world on the **Select a World** screen, in folder-name order
(up to 16). Folders starting with `_` are ignored — `_template/` is a blank starting point.

A custom level pack is the same folder zipped up: make one with **Theme Editor** on the main
menu (*Export .zip*), load it with **Load pack (.zip)** on the world screen. To turn a custom
pack into an official world, unzip it into a new folder here, e.g. `themes/07-my-world/`.

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
| `style.maze` | Maze colors for levels without their own theme: `{ "wall": …, "path": … }`, the same format as a map's `theme` (easiest to make in the Theme Editor) |
| `style.cursorColor` | Cursor color for levels without their own (optional) |
| `style.badge` | The in-game level number / title badge (below) |

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

A theme can replace the level select screen and show an intro screen before each level
(`screens.select`, `screens.intro`). Both are laid out on a 1280×720 stage — design them in the
**Theme Editor** (tabs *Level select* / *Level intro*); the format is written into theme.json.

- `screens.<name>.background`: `color`, optional `color2` (gradient), `image` (file), `fit`
  (`cover` / `contain` / `tile`), `dim` (0–0.9)
- `screens.<name>.elements`: `text`, `image`, `box`, `levelGrid` (level buttons; pages through
  packs with more levels than cells), `back`, `start` (the √ that begins a level), `stars`,
  `progress`. Each has `x`, `y`, `w`, `h`, optional `rotate`, `opacity` and `when`
  (`allComplete`, `notComplete`, `cleared`, `notCleared`).
- Text placeholders: `{theme}`, `{description}`, `{author}`, `{credits}`, `{released}`,
  `{cleared}`, `{total}`, `{stars}`, `{maxStars}`, and on the intro `{n}`, `{nn}`, `{title}`,
  `{difficulty}`, `{difficultyLabel}`, `{best}`.
- `credits`: free text shown with `{credits}` (designers, music, …).
- `fonts`: `[{ "family": "LCD", "file": "fonts/lcd.ttf" }]` — font files in the pack, picked by
  `family` for texts and level buttons. Built-in fonts: `title`, `main`, `serif`, `heavy`,
  `condensed`, `digital`, `hand`, `blackletter`, `mono`.
- Library fonts: the fonts in `src/assets/fonts/etc` can be used by id anywhere a font is picked
  (texts, level buttons, `style.badge.font`), e.g. `"font": "paperlogy-bold"`. The ids, copyrights
  and licenses are listed in `src/assets/fonts/LICENSES.md` and in-game under
  **Options → Font licenses**. Fonts whose license isn't stated in the file are marked ⓘ in the pickers.

Official themes have 21 level slots. Custom packs can hold any number of levels.
