# Game rules as implemented

This is the format the engine (`src/engine.js`) follows. The party-friendly relaxations are marked ✱.

## Rounds
| Round | Board | Values | Daily Doubles |
|---|---|---|---|
| Round 1 | 6 categories × 5 clues | 200, 400, 600, 800, 1000 | 1 |
| Double Round | 6 × 5 | 400, 800, 1200, 1600, 2000 | 2 (in different categories) |
| Final Round | 1 clue | Wagered | — |

- **Values and Daily Double counts** can be changed: values per clue in the CSV, Daily Double counts in Admin.
- **Missing rounds** are skipped.
- **Daily Double placement** is random, weighted toward rows 3–5 and never in the top row. A CSV `daily_double=yes` pins the location instead.

## Clue flow
1. The team in control picks a clue. The host reads it, then opens the buzzers.
2. Buzzing before the buzzers open locks that phone out for 250 ms.
3. The first buzz answers, with a 5-diya visual timer. The host decides when time is up ✱.
4. **Correct:** +value, and that team takes control.
5. **Wrong:** −value, and the buzzers reopen for teams that haven't tried. Each team gets one attempt per clue.
6. **Nobody gets it:** the answer is shown and control does not change.
7. **No phrasing rule:** answers don't need to be phrased as a question ✱.

## Daily Double
- Only the team in control plays it, and there is no buzzing.
- **Wager:** at least $5, and at most the team's score or the round's top value, whichever is higher. A team with a negative score can therefore still wager up to the top value.
- Correct adds the wager and wrong subtracts it. The team keeps control either way.

## Between rounds
- The Double Round starts with the lowest-scoring team in control. Ties go to the earlier team.

## Final Round
- **Eligibility:** only teams with a score above 0 play. If none qualify, the game ends.
- **Wagers:** each team wagers from 0 to its score in secret, on its phone. A missing wager counts as 0.
- **Clue and timer:** the clue is shown, and the host starts the 30-second think timer.
- **Answers:** each team types its answer on its phone. The host can type answers for teams that wrote on paper ✱.
- **Reveal:** from the lowest score to the highest, in three steps: the answer, then the host's ✓/✗, then the wager and new score.
- **Winner:** the team with the highest score. Ties are co-winners, or the host runs a tiebreaker clue out loud and awards it with ± ✱.

## Host powers ✱
- Undo any step.
- Use ± on any score.
- Give control to any team.
- Judge a team that answered without buzzing.
- End the game early.
- Reset to the lobby.
