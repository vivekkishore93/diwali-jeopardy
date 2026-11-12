# Diwali Quiz Night: a quiz-board party game for the home network

## Context
This is a Diwali party trivia game that uses the classic TV quiz-board mechanics:
- Round 1 with 1 Daily Double, a Double round with 2, and a Final round with wagers.
- It runs on the user's home server, so anyone on the Wi-Fi can open it.

Screens:
- The TV (a laptop connected over HDMI) shows the board.
- The host runs the game from a separate control page.
- Teams buzz in from their phones.

Questions come from editable CSV files. Any categories or questions can be swapped in later without code changes.

The look copies the show's *mechanics and animations*: board fill-in, tile zooming to full screen, the Daily Double splash, podiums and the Final reveal. It uses an original Diwali visual identity (indigo/maroon/gold, diyas, rangoli, fireworks) and original synthesized sounds. It does not use the show's logo, fonts or music.

Decisions so far:
- 2–4 teams.
- Phone buzzers.
- A local Node server on the home server.
- Built in this cloud session, then pushed to GitHub, then cloned on the server.

## Architecture
- **Server:** Node 18+, plain `http` plus the `ws` WebSocket library. Dependencies are just `ws`, `qrcode` and `multer` (or a small built-in multipart handler). There is no frontend build step: pages are vanilla HTML/CSS/ES modules.
- **Network:** the server binds `0.0.0.0:3000`. On start it prints LAN URLs such as `http://192.168.x.x:3000`.
- **Authoritative game state lives on the server.**
  - Every page is a client that sends *actions* and receives the broadcast state.
  - The engine is a pure reducer with an event log, so **undo** comes for free.
  - State is saved to `data/game.json` after each action, so a crash or refresh resumes the game.
- **Buzzing:** the server timestamps buzzes, and the first one received after the host opens buzzers wins. A buzz before that locks the phone out for 0.25 s. Phones vibrate and flash in the team's colour.

### Pages
| URL | Who | Purpose |
|---|---|---|
| `/admin` | Host, before the game | Manage question sets. Upload a CSV, edit the board in a grid editor (categories, clues, answers, optional fixed Daily Double), download a CSV, choose the active set. Set up teams (names, colours). Optional PIN. |
| `/tv` | TV, full screen | The board, clue zooms, Daily Double splash, score podiums, Final reveal, fireworks, and a QR code for players to join. Display only, no controls. |
| `/host` | Host phone or laptop | Shows the correct answer. Controls: pick tile, open buzzers, ✓ / ✗ for the team that buzzed, "nobody", enter the DD wager, give control to a team, ± score, undo, next round, Final wager and answer entry, sound and volume. |
| `/play` | Each team's phone | Join a team, then a giant BUZZ button. Also used to enter the Final wager and answer privately. |

## Game rules (from the rules research agent)
- **Board:** 6×5. Round 1 values are 200–1000 and Double round values are 400–2000. Everything can be changed in the config; smaller boards like 5×5 are allowed.
- **Daily Doubles:** 1 in Round 1 and 2 in the Double round, placed randomly.
  - Never in the top row, weighted toward rows 3–5.
  - The two in the Double round go in different categories.
  - A CSV can pin a specific clue as a DD instead.
- **Clue flow:** host reads → host opens buzzers → first buzz answers.
  - Correct: +value, and that team picks next.
  - Wrong: −value, buzzers reopen for the other teams. Each team gets one try per clue.
  - "Nobody": reveal the answer, and control stays where it was.
- **Daily Double:** only the team that picked it answers.
  - The wager runs from 5 to max(the team's score, the round's top value).
  - "True Daily Double" lets a team bet everything.
- **Double round:** the lowest-scoring team picks first. Negative scores are allowed in Rounds 1 and 2.
- **Final round:**
  1. Category shown.
  2. Teams with a score above 0 wager 0–score from their phones.
  3. Clue shown, with a 30 s timer.
  4. Answers typed on phones.
  5. Reveal from lowest score to highest: answer, then host ✓/✗, then wager, then new score.
  6. A tie for first gets a host-run tiebreaker clue or co-winners.
- **Casual relaxations:** answers don't need to be phrased as a question, and there is no round clock.
  - The host can override anything (manual score, reassign control, undo).
  - There is an optional 5 s answer timer, shown on the TV as diya "lights" going out.

## CSV format (`questions/*.csv`)
```
round,category,value,clue,answer,daily_double
1,Festival of Lights,200,"This 5-day festival marks Rama's return to ...",Diwali,
1,Festival of Lights,400,...,...,
2,Sweets,800,...,...,yes
final,Mythology,,"...",...,
```
- `round` is `1`, `2` or `final`.
- `value` is optional; if left out, values come from row order.
- `daily_double` is optional (`yes`) and overrides random placement.
- Proper quoting is supported, so commas and quotes work inside clues.
- A validation report appears in `/admin` and lists missing cells or a wrong number of clues per category.
- The repo includes `questions/diwali-starter.csv`, a complete playable Diwali set (2 rounds + Final), and `questions/TEMPLATE.csv`.

## Look and feel (from the design research agent)
- **Stage:** a fixed 1920×1080 stage scaled to the screen, with 5% overscan-safe margins.
- **Palette:**

  | Use | Colour |
  |---|---|
  | Board | Royal indigo `#1B1F6B` with tile gradient `#14175A`→`#2A2F8F` |
  | Values and borders | Marigold gold `#F5B82E` |
  | Podiums | Maroon `#6E0F1F` |
  | Text | Cream `#FFF4DC` |
  | Accents | Saffron and magenta |

- **Fonts (Google Fonts):**

  | Use | Font |
  |---|---|
  | Clues | Oswald or Anton |
  | Values | Bebas Neue |
  | Titles | Yatra One |
  | Podium names | Kalam |
  | UI | Poppins |

- **Motifs:** rangoli SVG corners, lantern icons on category headers, and diya timer lights.
- **Animations:**
  - Random staggered board fill-in, with a tick sound per tile.
  - Category flip reveal.
  - FLIP zoom from the tile's rect to full screen; the clue is uppercase with a hard drop shadow and fit-text, minimum 56 px.
  - Used tiles go blank.
  - Daily Double: spin and scale, a canvas particle burst, and a "DIYA DOUBLE!" splash (the wording can be changed).
  - Score count-up animation; negative scores show in red.
  - Final round reveal sequence, and fireworks for the winner.
- **Revised after user feedback: lean nostalgic.**
  - Use the classic show-style blue board (deep blue tiles, gold values, white uppercase clues), with Diwali as *accents only*: sparkle particles, diya timer lights, fireworks for DD and the winner, a subtle rangoli frame.
  - Default fonts are close-looking free ones: a bold condensed face for values and a serif-style face for clues.
  - The game title is editable in `/admin`.
  - **Custom-asset overrides:**
    - Any file in `public/sounds/` replaces the synthesized default with the same name: `think`, `daily-double`, `board-fill`, `correct`, `wrong`, `times-up`, `fanfare` (mp3/ogg/wav).
    - Any file in `public/fonts/` with the matching name (`clue.*`, `value.*`) overrides the default font.
    - The user supplies their own files. The app ships with only original sounds and free fonts.
- **Sound:** Web Audio, all synthesized:
  - fill arpeggio
  - correct chime
  - wrong buzz
  - DD sting
  - times-up
  - original Final "think" loop
  - fanfare

  A master mute is available on `/host`.
- **Performance:** only `transform` and `opacity` are animated, and the particle canvas is capped at DPR 1.

## Files
```
package.json            # scripts: start, dev, test
server.js               # http + static + ws + upload endpoints, LAN URL printout
src/engine.js           # pure reducer: state + action -> state; DD placement; undo log
src/csv.js              # parser/serializer + validation
src/store.js            # question sets on disk, game.json persistence
public/tv.html  js/tv.js  css/tv.css
public/host.html js/host.js
public/play.html js/play.js
public/admin.html js/admin.js
public/js/net.js        # ws client w/ auto-reconnect
public/js/fx.js         # particles/fireworks, FLIP zoom, fit-text
public/js/audio.js      # synthesized sounds
questions/diwali-starter.csv, questions/TEMPLATE.csv
test/engine.test.js, test/csv.test.js   # node:test
README.md               # run on server, CSV format, host cheat-sheet
CLAUDE.md + docs/SPEC.md  # this spec, so the CLI on the server has full context
```

## Handoff to the home server
1. The user creates an empty GitHub repo (e.g. `diwali-quiz`), which gets attached to this session.
2. I build and test here, then push.
3. On the server:

   ```bash
   git clone <repo> && cd diwali-quiz && npm install && npm start
   ```

4. Optional: keep it running with `pm2` or a systemd unit (instructions in the README).
5. On the laptop connected to the TV, open `http://<server-ip>:3000/tv` and press F for full screen.
6. The host opens `/host` on a phone. Players scan the QR code on the TV to reach `/play`.
7. Follow-up changes: run `claude` in the clone on the server. `CLAUDE.md` and `docs/SPEC.md` give it the full context.

## Verification
- `npm test` covers:
  - The engine: scoring, wrong answer then rebuzz, the DD wager min/max, DD placement constraints, Double round starting team, Final eligibility and reveal order, undo.
  - The CSV parser: quotes, validation errors.
- A Playwright end-to-end run against `npm start` opens `/tv`, `/host` and 3 `/play` pages. It plays:
  - a normal clue (buzz, wrong, rebuzz, correct)
  - a Daily Double
  - advancing to the Double round
  - a full Final round with phone wagers and answers

  It takes 1920×1080 screenshots of the TV at key moments to check the look.
- The tests also upload a new CSV in `/admin` and check that the board changes.
- **The user, on the server:** connect 2–3 real phones over Wi-Fi and check buzz latency, the QR join and vibration.
