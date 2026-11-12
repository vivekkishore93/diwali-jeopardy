# 🪔 Diwali Quiz Night

A quiz-board party game for your home network.

- **TV:** the classic board on your TV, through a laptop plugged in over HDMI.
- **Host:** a control page on your phone or laptop.
- **Players:** every team buzzes in from their own phone.

## Quick start (on your home server)

You need Node.js 18 or newer.

```bash
git clone https://github.com/vivekkishore93/diwali-jeopardy.git
```

```bash
cd diwali-jeopardy && npm install
```

```bash
npm start
```

The server prints its addresses, for example:

```
  TV screen   http://192.168.1.50:3000/tv
  Host        http://192.168.1.50:3000/host
  Players     http://192.168.1.50:3000/play   (QR code shown on the TV)
  Admin       http://192.168.1.50:3000/admin
```

| Page | Open it on | What it does |
|---|---|---|
| `/tv` | The laptop connected to the TV | The board, clues, animations and sound. **Click once** to turn on sound and full screen. **F** toggles full screen. |
| `/host` | Your phone or a second laptop window | Shows the answers. Open buzzers, mark ✓/✗, run Daily Double wagers and the Final round, fix scores, undo. |
| `/play` | Every player's phone (scan the QR code on the TV) | Pick your team, then hit the giant BUZZ button. Final wagers and answers are typed here too. |
| `/admin` | Anywhere | Upload or edit question CSVs, pick the active set, set up teams, change labels and timers. |

### Options (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `ADMIN_PIN` | *(none)* | When set, `/host` and `/admin` ask for this PIN |
| `PUBLIC_URL` | auto-detected | The URL in the QR code, e.g. `http://quiz.lan:3000` |

Example:

```bash
ADMIN_PIN=2580 PORT=8080 npm start
```

### Keep it running (optional)

To keep it running with pm2:

```bash
npm i -g pm2 && pm2 start server.js --name diwali-quiz && pm2 save
```

Or use a systemd unit with `ExecStart=/usr/bin/node /path/to/diwali-jeopardy/server.js` and `WorkingDirectory=` set to the repo.

If phones can't connect, allow the port through the server's firewall:

```bash
sudo ufw allow 3000
```

## Questions: the CSV format

Put CSV files in `questions/`, or upload them on `/admin`.

```csv
round,category,value,clue,answer,daily_double
1,Diwali 101,200,Diwali is known as the festival of these,Lights,
1,Diwali 101,400,"Commas are fine inside ""quotes""",Diyas,
2,Sweets,800,A Round 2 clue,The answer,yes
final,Mythology,,The final clue,The final answer,
```

- **`round`:** `1`, `2` or `final`.
- **`value`:** optional. If left blank it is filled in by position: 200–1000 in Round 1 and 400–2000 in Round 2.
- **`daily_double`:** optional. Put `yes` to choose a Daily Double yourself. Otherwise they are placed at random: 1 in Round 1 and 2 in Round 2. They never go in the top row, and the two in Round 2 go in different categories.
- **Board size:** 6 categories × 5 clues fits the TV best. Fewer categories or clues also works.
- **Missing rounds:** with no Round 2 the game skips it, and with no Final it ends after the last round.
- **Starter files:**
  - `questions/diwali-starter.csv` is a complete, playable Diwali game.
  - `questions/TEMPLATE.csv` is a blank starting point.

Excel or Google Sheets work fine: **File → Download → CSV**.

## How a game runs

1. **Lobby.** Players scan the QR code and pick a team. The host taps **Start game**.
2. **Board.** The round title zooms in, the board fills in, and the host reveals categories one by one.
3. **Choosing a clue.** The team in control (marked by a diya above its podium) calls a clue, and the host taps it. The tile zooms to full screen.
4. **Buzzing.** The host reads the clue, then taps **Open buzzers**. A team that buzzes too early is locked out for ¼ second.
   - The first team to buzz answers, and 5 diyas count down.
   - ✓ adds the value, and that team picks next.
   - ✗ subtracts the value, and the other teams can buzz again.
5. **Daily Double.** Only the team in control plays it. It wagers from $5 up to its score or the round's top value, whichever is higher.
6. **Double Round.** Values double, and the team with the lowest score picks first.
7. **Final Round.** Only teams with a score above $0 play.
   1. Teams wager in secret on their phones.
   2. The clue appears with a 30-second think tune and diya timer.
   3. Teams type their answers.
   4. Answers are revealed from the lowest score to the highest.
   5. Fireworks for the winner! 🎆

**If something goes wrong:**
- **Undo** reverses any step.
- **±** fixes a score.
- Tap a team on the score list to give it control.
- The game state is saved to `data/game.json`, so a server restart picks up where you left off.

### Host keyboard shortcuts

These work on `/host` with a keyboard.

| Key | Action |
|---|---|
| **B** | Open buzzers |
| **C** | Correct |
| **W** | Wrong |
| **N** | Show the answer |
| **Enter** | Back to the board |
| **U** | Undo |

## Make it sound and look the way you like

- **Sounds:** drop audio files into `public/sounds/`. Each one replaces the built-in synthesized sound with the same name: `think`, `daily-double`, `board-fill`, `correct`, `wrong`, `times-up`, `fanfare`, `buzz-in`, `reveal`, `tick`. Formats: `.mp3`, `.ogg`, `.wav` or `.m4a`.
- **Fonts:** drop `clue.woff2`, `value.woff2` or `category.woff2` into `public/fonts/`.
- **Labels and timers:** the title, the "DAILY DOUBLE" and "FINAL ROUND" labels, round names, timers and Daily Double counts are all on `/admin`.

## Development

```bash
npm test
```

```bash
npm run dev
```

`npm test` runs the engine and CSV unit tests (`node --test`). `npm run dev` restarts the server when files change.

How the code is organised:
- **No build step:** `public/` is plain HTML, CSS and ES modules.
- **Rules:** `src/engine.js`, a pure reducer that holds all the game rules and the undo history.
- **Server:** `server.js` serves the pages and the WebSocket. It sends each kind of screen only what it may see, so phones never receive answers.

See `CLAUDE.md` and `docs/` for the full spec.
