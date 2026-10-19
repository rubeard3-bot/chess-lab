# Test fixtures (protected)

Trusted reference data. Agents may not edit anything in this folder
(see `.claude/protected-paths.txt`); only Russell changes golden data.

## lichess_LAPlrQCB.pgn
A real 2+1 game (wSwayze vs russelll1234578, 2026-10-09) exported from
Lichess **with Lichess's own engine evaluations** embedded as `[%eval]`
comments. Lichess's official accuracy for this game: **White 53%, Black 51%**.

Feeding these exact evaluations into Chess Lab's `calculateAccuracy` must
reproduce Lichess's numbers. That proves the accuracy formula itself matches
Lichess. (Chess Lab's live analysis can still differ, because its in-browser
Stockfish produces different evaluations than Lichess's server engine.)
