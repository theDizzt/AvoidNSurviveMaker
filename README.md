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
    types.ts       # Map schema (MapData v1)
    geometry.ts    # Segment–rectangle intersection (Liang–Barsky)
    mover.ts       # Moving obstacle position as a closed-form function of time (deterministic)
    simulation.ts  # Fixed 1 ms tick simulation and replays
    validate.ts    # Validation and warnings for external maps
    share.ts       # Map <-> URL share code (deflate-raw + base64url)
    levels.ts      # Built-in levels
  web/
    input.ts       # High-precision input (pointerrawupdate + getCoalescedEvents), polling-rate measurement
    play.ts        # Play screen
    editor.ts      # Map editor
    render.ts      # Canvas rendering
    preload.ts     # Loading screen tasks (fonts, shared map) with progress and timeout
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

## How 1 ms hit detection works

1. **Input**: Listens to `pointerrawupdate` (when supported) or `pointermove`, and uses `getCoalescedEvents()` to recover every raw sample batched between frames. Each sample's `timeStamp` is used as its time.
2. **Simulation**: The cursor path between samples is treated as line segments, split at every 1 ms boundary, and checked continuously.
   - Walls: exact segment intersection, so you can't tunnel through a wall no matter how fast you move.
   - Moving obstacles: checked as a relative-motion segment in the obstacle's frame, so collisions where the cursor and obstacle pass through each other are caught.
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
- [x] Map editor (walls, obstacles and paths, START/GOAL, undo/redo, autosave, JSON import/export)
- [x] URL sharing (no server)
- [ ] Phase 2: Supabase integration — map browser/search/likes, leaderboards, server-side replay verification
