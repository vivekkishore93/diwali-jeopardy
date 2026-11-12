# Diwali Quiz Night: notes for Claude

This is a LAN party quiz-board game in the classic TV format, with a Diwali theme. It runs on the owner's home server; the TV shows `/tv` through a laptop over HDMI.

- **Original spec and plan:** `docs/PLAN.md`
- **Rules reference:** `docs/RULES.md`
- **Setup and usage:** `README.md`

## Commands
- `npm start`: start the server on port 3000. Env vars: `PORT`, `ADMIN_PIN`, `PUBLIC_URL`, `HOST`, `DATA_ROOT`.
- `npm run dev`: start with auto-restart on file changes.
- `npm test`: unit tests with `node:test` (`test/*.test.js`).

## Architecture
- **`server.js`:** plain `http` plus `ws`.
  - Serves `public/`, plus `/vendor/fonts/*` from `node_modules/@fontsource` so fonts work offline.
  - Provides the `/api/*` routes: sets CRUD, QR code, info, assets.
  - Runs the WebSocket at `/ws?role=tv|host|play|admin&pin=`.
  - The server holds the single authoritative `state`. After each action it saves to `data/game.json` and broadcasts `viewFor(state, role)`.
- **`src/engine.js`:** a pure reducer, `dispatch(state, action, {now, rng})`, that returns a new state.
  - All game rules live here.
  - `history` holds snapshots of `game` for undo. Meta-level settings (`meta`: set, title, config) are not undoable.
  - Handlers that return `true` skip the history (category reveals, wagers, answers).
  - `game.event = {id, type, ...}` drives the TV's animations and sounds. Ids always increase, even after an undo.
- **`viewFor(state, role)`:** filters what each client may see. Answers, Daily Double positions, unrevealed categories, and final wagers or answers are hidden from `tv` and `play`. There is a test for this, so keep it passing.
- **`src/csv.js`:** CSV parsing and serializing, plus validation. Columns are `round,category,value,clue,answer,daily_double`.
- **`src/store.js`:** reads and writes `questions/*.csv` and `data/game.json`.
- **`public/js/`:**

  | File | Role |
  |---|---|
  | `tv.js` | Renders the TV and maps event types to animations |
  | `host.js` | Host controls |
  | `play.js` | Phone buzzer |
  | `admin.js` | Admin page |
  | `audio.js` | Web Audio synthesized sounds; files in `public/sounds/<name>.*` override them |
  | `fx.js` | FLIP zoom, fit-text, particles and fireworks |
  | `net.js` | WebSocket client with reconnect and clock sync |

- **The TV is a fixed 1920×1080 `#stage`** scaled to fit the screen.

## Roles and permissions
- **`play`:** may only send `buzz`, `finalWager` and `finalAnswer`.
- **`tv`:** display only.
- **`host` and `admin`:** can send anything, including `setMeta` (sanitized server-side).

## Conventions
- Vanilla JS ES modules with no build step and no frameworks. Keep dependencies minimal (`ws`, `qrcode`, `@fontsource/*`).
- Do not add the TV show's copyrighted assets (logo, theme music, proprietary fonts). Users can drop their own files into `public/sounds` and `public/fonts`.
- To add a new action:
  1. Handle it in `applyAction` in `engine.js`, emitting an event.
  2. Expose any new fields through `viewFor`.
  3. Add host UI in `host.js`.
  4. Add TV handling in `tv.js` `handleEvent`.
  5. Add a test.
