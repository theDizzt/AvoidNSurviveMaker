# Avoid N Survive Maker

A web-based "avoid the walls with your mouse" maze game, with a built-in map editor. Get from START to GOAL without touching a wall, a moving obstacle, or the edge of the map.

## Getting started

**Windows, quickest way:** double-click `run-dev.bat`. It installs dependencies on first run, starts the dev server, and opens the game in your browser. Saving any file reloads the page automatically (CSS changes apply instantly without a reload). Press Ctrl+C in the console window to stop.

Or from a terminal:

```bash
npm install
npm run dev       # dev server (http://localhost:5173)
npm test          # core unit tests
npm run build     # static site in dist/ — deploy as-is to GitHub Pages, Vercel, etc.
```

> `pointerrawupdate` is only available in secure contexts (HTTPS or localhost). Deploy over HTTPS.

## Project structure

```
src/
  core/            # No DOM dependencies — reusable on a server later (replay verification)
    types.ts       # Map schema (MapData v2): objects = shape × role × motion/rotation
    geometry.ts    # Segment/polygon crossings, point-in-polygon, rect helpers
    shape.ts       # Rect / circle / polygon / freeform → one polygon used for both drawing and collision
    motion.ts      # Routes (straight, curve, circle), repeat, easing, rotation — closed-form in time
    object.ts      # Compiled objects and their pose (translate + rotate around a pivot) at time t
    simulation.ts  # Fixed 1 ms tick simulation and replays
    account.ts     # Nickname / email / password rules, Name#0042 formatting
    theme.ts       # Theme presets and color helpers
    validate.ts    # Validation and warnings for external maps
    share.ts       # Map <-> URL share code (deflate-raw + base64url)
    levels.ts      # Built-in levels
  web/
    input.ts       # High-precision input (pointerrawupdate + getCoalescedEvents), polling-rate measurement
    play.ts        # Play screen
    editor.ts      # Map editor
    render.ts      # Canvas rendering
    preload.ts     # Loading screen tasks (fonts, account, shared map) with progress and timeout
    liquid.ts      # Pastel liquid pouring background (metaballs) on menu screens
    theme-panel.ts # Map theme editor (solid / gradient / pattern fills)
    auth/          # Supabase sign-up / sign-in, email verification, Turnstile CAPTCHA
    options.ts     # Player options (cursor trail, run timer, debug panel), saved per browser
    main.ts        # Screen flow: preload → main menu → play / options / map editor
  assets/
    fonts/         # Web fonts (.woff2)
    images/        # Sprites, backgrounds, icons
    sounds/        # Sound effects and music
```

### Using assets

Files in `src/assets/` go through Vite: import them and you get a hashed, cache-safe URL in the build.

```ts
import hitSound from '../assets/sounds/hit.mp3';
const audio = new Audio(hitSound);
```

```css
@font-face {
  font-family: 'GameFont';
  src: url('../assets/fonts/game-font.woff2') format('woff2');
  font-display: swap;
}
```

Use a root-level `public/` folder only for files that must keep a fixed URL (e.g. `favicon.ico`, `robots.txt`); those are copied to `dist/` as-is.

## Accounts

Players can create an account (email, password, nickname, CAPTCHA), verify their email, and sign in.
Names are shown as `Nickname#1234`: a random 4-digit tag keeps `nickname + tag` unique, so up to 9999
players can share a nickname. Backed by Supabase; setup steps (database migration, auth settings,
Turnstile, `.env.local`) are in [docs/ACCOUNTS.md](docs/ACCOUNTS.md). Without that setup the game runs
offline and the account screen says so.

## Map editor

Every object is a **shape** (rectangle, circle, polygon, freeform) with a **role** and an optional **behavior**:

- **Path** — safe floor. Once a map has any path, everything outside the paths is deadly void. START and GOAL always count as floor.
- **Wall** — deadly everywhere.
- **Moving** — follows a route of markers: straight, curve (smooth spline through the markers) or circle (orbit around a center marker). Options: repeat (loop / ping-pong / once), speed, smooth start/end (easing per leg), start delay (negative = start partway through).
- **Rotating** — spins around a draggable pivot. Options: speed, angle per cycle (360 + loop = continuous spin), direction, repeat, smooth start/end, start delay. Rotating objects can also have a route.

The game screen is always **16:9**. New maps are 960×540; the editor offers 640×360 up to 1920×1080. Maps made in another ratio still open, centered with bars around them.

The palette lists all 26 tools by number:

| # | Tools |
|---|---|
| 1–4 | Rectangle / circle / polygon / freeform **path** |
| 5–8 | Rectangle / circle / polygon / freeform **wall** |
| 9–10 | START area, GOAL area |
| 11–14 | Moving paths |
| 15–18 | Rotating paths |
| 19–22 | Moving walls |
| 23–26 | Rotating walls |

Editing: drag to draw rectangles/circles (Shift = square/circle), click to place polygon points (freeform: click = curved point, Shift+click = sharp corner; click the first point or Enter to close). With Select (V): drag to move, drag handles to reshape, double-click a polygon vertex to toggle curve, double-click an edge to add a vertex, Alt+click a vertex to remove it. Ctrl+Z / Ctrl+Y undo/redo, Ctrl+D duplicate, Delete removes. Maps saved in the older v1 format are migrated automatically.

### Themes

Each map can carry its own look (Map Editor → **Theme**), saved with the map and kept in share links. Two surfaces are styled separately:

- **Walls & obstacles** (static, moving and rotating walls)
- **Paths**

Each surface gets an outline color and a fill: **solid**, **gradient** (linear with an angle, or radial; two colors) or **pattern** (stripes, diagonal, dots, grid, checker; color, background, tile size). Gradients and patterns are laid out in each object's own frame, so they move and rotate with it. Presets: Default, Neon, Lava, Forest, Candy, Mono — pick one and tweak it, or build your own.

## How 1 ms hit detection works

1. **Input**: Listens to `pointerrawupdate` (when supported) or `pointermove`, and uses `getCoalescedEvents()` to recover every raw sample batched between frames. Each sample's `timeStamp` is used as its time.
2. **Simulation**: The cursor path between samples is treated as line segments, split at every 1 ms boundary, and checked continuously.
   - Each piece is mapped into every object's own frame (undoing its movement and rotation), so moving and rotating objects become static polygons and the cursor's path becomes a relative-motion segment. Nothing can be skipped over, no matter how fast the cursor or the object moves.
   - All boundary crossings along the piece are collected and each interval between them is checked: safe = on a path (or the map has none) and inside no wall.
   - If the mouse is idle, the render loop still advances time, so an obstacle running into a stationary cursor counts as a hit (with a 40 ms margin for input latency).
3. **Deterministic**: The same input samples always produce the same result. `getReplay()` / `runReplay()` let a server re-verify a recorded run.

The real sample interval is capped by the mouse's polling rate (1000 Hz → 1 ms, 125 Hz → 8 ms). You can check it in the **input precision debug** panel below the play area.

## Anti-cheat

- The run only starts when you click inside the START area.
- The run fails if the cursor leaves the browser window (`pointerout`), the window loses focus (`blur`, tab switch), or a touch/pen pointer is lifted.
- A map can only be shared after its creator clears it in test play; any edit resets that verification.

## Roadmap

- [x] 1 ms simulation with continuous collision detection
- [x] High-precision input and debug display
- [x] Map editor: 26 tools (paths/walls × rectangle/circle/polygon/freeform × static/moving/rotating, START/GOAL), routes with markers, easing, undo/redo, autosave, JSON import/export
- [x] URL sharing (no server)
- [x] Accounts: Supabase sign-up / sign-in with email verification, CAPTCHA, `Nickname#tag`
- [ ] Map browser/search/likes, leaderboards, server-side replay verification
