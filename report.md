# Chess Analysis Report

# Personalized Improvement Report — Black Pieces

## Performance Overview

**Record:** 0 wins / 0 draws / 1 loss (single game analyzed vs. Kulio54)
**Error count:** 7 blunders, 14 mistakes, 10 inaccuracies in one game — a very high error density.

The single most notable trend: **errors snowballed across phases.** You drifted in the opening (5 mistakes!), got crushed tactically in the middlegame (5 blunders), and the position collapsed completely in the endgame (a +30000 cp blunder on move 34 indicates you walked into a mate). This wasn't one bad move — it was a chain reaction triggered by an unfamiliar opening structure. With only one game in the dataset, treat this report as a diagnostic snapshot, not a verdict on your overall play.

## Opening Analysis

You played into an **E70 King's Indian Defense** (likely a sideline where White avoided the mainline Classical or Sämisch). The engine's repeated suggestion of **...Ng4** at moves 6, 7, and 9 is a huge clue: in many KID structures, the knight maneuver **Nf6–g4** is a thematic idea to challenge a White bishop on e3, provoke h3, or prepare ...f5/...e5 breaks. You missed it three times in a row.

**What you played instead** — moves like 6...Re8, 7...e5, 9...a5 — are not bad-looking moves in isolation, but they were poorly timed for the specific structure. Then on move 13 you played **Nc5** when **Ne5** was correct (centralization vs. flank); on move 15 you missed **Bxh6** (a tactical resource), and the engine kept suggesting Bxh6 on moves 16 and 17 — meaning the opportunity hung in the air for **three moves** and you didn't see it.

**Diagnosis:** You're playing the King's Indian by feel, not by plan. The KID is one of the most plan-heavy openings in chess — you need to know the standard knight maneuvers and pawn breaks cold.

**Concrete study path:**
- **Book:** *The King's Indian: A Complete Black Repertoire* by Victor Bologan — focused on understanding, not memorization.
- **Video:** GM Sam Shankland's KID series on Chessable, or GingerGM's "Killer KID" lectures on YouTube for typical pawn structures.
- **Drill:** On Lichess, search the study **"King's Indian Defense — Typical Plans"** and play through the model games. Specifically learn the **...Nf6–g4–e5** and **...Nf6–h5–f4** maneuvers.

## Tactical Weaknesses

**Error distribution:** Mistakes (14) dominate over blunders (7), but the blunders were catastrophic — one was 30,173 cp (a missed mate). The **middlegame is your worst phase** (5 blunders, 4 mistakes, 7 inaccuracies).

Looking at the move data, three patterns jump out:

1. **You repeatedly miss knight captures on d1.** The engine recommended **Nxd1** at moves 20, 24, and 27 — picking off material — and you missed it every time. This suggests you're not scanning for **undefended pieces on the back rank** when calculating.
2. **You miss in-between moves and forcing checks.** On move 34, **Nd1+** was a forced sequence; you played Qd3+ instead and got mated. You're choosing the "obvious" check rather than calculating which check actually works.
3. **Knight maneuvering is shaky.** Moves 28 (Ne5 vs. Nxc4), 40 (Nb5+ vs. Ne6+), and 13 (Nc5 vs. Ne5) all show you reaching for the wrong knight square — likely because you're moving by general principles ("centralize," "give check") instead of calculating concrete consequences.

## Critical Moments Breakdown

### Blunder #1 — Move 34: Qd3+ instead of Nd1+
**Position (FEN):** `r3k3/1p5p/3p2pQ/3P4/2P1q3/pPK5/Pn1N4/4n1RR b - - 3 34`
You had **Nd1+**, a discovered/forking attack that wins on the spot (the engine evaluates it as decisive). Instead, you played **Qd3+**, which allowed a forced mate by White. The CP loss of 30,173 means you went from winning to getting mated in a few moves.
**Concept missed:** When you have multiple checks, **calculate each one to a conclusion** before choosing. Knight checks especially can be devastating because the king can't block them. You went for the queen check because it "felt active," but Nd1+ was geometric — it attacked the king AND created a deadly threat.

### Blunder #2 — Move 28: Ne5 instead of Nxc4
**Position (FEN):** `r7/1p2q1kp/3p2p1/3P4/2P1r1n1/pP3N2/Pn1Q4/1NK3RR b - - 7 28`
**Nxc4** simply wins a pawn and attacks the queen on d2 — a straightforward double attack. You played Ne5 (centralization instinct again) and lost ~3.9 pawns of evaluation.
**Concept missed:** **Material before activity.** Free pawns matter, especially when the capture comes with tempo (attacking the queen). Always ask: "Can I take something?" before "Where does my piece belong?"

### Blunder #3 — Move 22: f2 instead of Bxb1
**Position (FEN):** `r2qr3/1p3pkp/3p1nP1/3P1b2/2P5/pPN2p2/Pn1Q4/1BKR2NR b - - 2 22`
You had **Bxb1** — capturing a piece! Instead you advanced the f-pawn (likely chasing some attacking idea against the White king). CP loss of 381.
**Concept missed:** **Don't get tunnel vision on attacks while ignoring free material.** This is the same theme as the missed Nxd1 captures — pieces hanging on the first rank that you're not registering during calculation.

## Your Improvement Plan

### 1. Tactics: Drill "Hanging Pieces" and "Knight Forks" on Chess.com or Lichess
Set Lichess Puzzle Themes to **"Hanging Piece"** and **"Fork"** specifically. Do **20 puzzles a day for 2 weeks**. Your data shows you literally walked past free knights and bishops three times in one game — this is a board-vision issue, fixable with reps. Also drill **"Mate in 2"** puzzles to fix the move-34 disaster (calculating forcing checks to the end).

### 2. Opening: Build a Real King's Indian Repertoire
Pick **one** KID resource and stick with it for 2 months. I recommend the **Chessable course "Lifetime Repertoires: King's Indian Defense" by GM David Howell** — it's structured for understanding plans, not just memorizing lines. Learn the typical ...Ng4 and ...Nh5 ideas the engine kept suggesting in your game.

### 3. Middlegame: Master "Candidate Moves" Discipline
Before every move, force yourself to write down (or mentally list) **three candidate moves**, including **every check, capture, and threat available to you**. Your blunders show you're choosing the first plausible move you see. Read **Axel Smith's "Pump Up Your Rating," Chapter on Calculation** — it teaches a concrete CCT (Checks-Captures-Threats) scanning routine.

### 4. Endgame: Learn King + Pawn Activity Basics
You had 2 blunders and 5 mistakes in the endgame. Before tackling complex endgames, nail down the fundamentals: **opposition, key squares, and the rule of the square.** Use **Jesus de la Villa's "100 Endgames You Must Know"** — start with chapters 1–4 only. Don't skip ahead; these basics underpin everything.

### 5. Mental Habit: The "Blunder Check" Pause
Before every move, do a **5-second sanity check**: "If I play this, what's my opponent's most forcing reply? Any check, capture, or threat?" Your move 34 (Qd3+ leading to mate) almost certainly came from playing on autopilot. Build the habit now of pausing BEFORE the move, not after. A reasonable target: take at least 15 seconds on every non-trivial move, even in blitz.

---

**Final word:** One game isn't enough to draw firm conclusions, so submit 10–15 more games for a fuller picture. But the patterns here — missing free pieces, weak opening plans, autopilot in critical moments — are very fixable. The fact that the engine kept suggesting the *same* moves repeatedly (Ng4, Bxh6, Nxd1) suggests that once you train your eye to see these motifs, your results will jump quickly. Get to work on those tactics puzzles today.

---

<details>
<summary>📊 Raw Statistics (click to expand)</summary>

```json
{
  "total_games": 1,
  "results": {
    "wins": 0,
    "draws": 0,
    "losses": 1
  },
  "total_blunders": 7,
  "total_mistakes": 14,
  "total_inaccuracies": 10,
  "avg_blunders_per_game": 7.0,
  "avg_mistakes_per_game": 14.0,
  "errors_by_phase": {
    "opening": {
      "blunders": 0,
      "mistakes": 5,
      "inaccuracies": 1
    },
    "middlegame": {
      "blunders": 5,
      "mistakes": 4,
      "inaccuracies": 7
    },
    "endgame": {
      "blunders": 2,
      "mistakes": 5,
      "inaccuracies": 2
    }
  },
  "openings_played": {
    "E70 \u2014 Unknown": 1
  },
  "opening_errors": [
    {
      "game": 1,
      "opening_name": "Unknown",
      "eco": "E70",
      "move": "6. Re8",
      "best_move": "Ng4",
      "cp_loss": 159
    },
    {
      "game": 1,
      "opening_name": "Unknown",
      "eco": "E70",
      "move": "7. e5",
      "best_move": "Ng4",
      "cp_loss": 138
    },
    {
      "game": 1,
      "opening_name": "Unknown",
      "eco": "E70",
      "move": "9. a5",
      "best_move": "Ng4",
      "cp_loss": 153
    },
    {
      "game": 1,
      "opening_name": "Unknown",
      "eco": "E70",
      "move": "13. Nc5",
      "best_move": "Ne5",
      "cp_loss": 174
    },
    {
      "game": 1,
      "opening_name": "Unknown",
      "eco": "E70",
      "move": "15. a3",
      "best_move": "Bxh6",
      "cp_loss": 124
    }
  ],
  "worst_blunders": [
    {
      "game": 1,
      "opening": "Unknown",
      "move": "34. Qd3+",
      "best_move": "Nd1+",
      "cp_loss": 30173,
      "phase": "middlegame",
      "fen": "r3k3/1p5p/3p2pQ/3P4/2P1q3/pPK5/Pn1N4/4n1RR b - - 3 34"
    },
    {
      "game": 1,
      "opening": "Unknown",
      "move": "44. Rb6+",
      "best_move": "Ra7+",
      "cp_loss": 954,
      "phase": "endgame",
      "fen": "4k3/1K5p/r2p2pQ/1P1P4/8/pPq1n3/P7/4R2R b - - 0 44"
    },
    {
      "game": 1,
      "opening": "Unknown",
      "move": "40. Nb5+",
      "best_move": "Ne6+",
      "cp_loss": 715,
      "phase": "endgame",
      "fen": "4k3/1pK4p/r2p2pQ/3P4/2Pn4/pP1q4/Pn1N4/6RR b - - 15 40"
    },
    {
      "game": 1,
      "opening": "Unknown",
      "move": "28. Ne5",
      "best_move": "Nxc4",
      "cp_loss": 388,
      "phase": "middlegame",
      "fen": "r7/1p2q1kp/3p2p1/3P4/2P1r1n1/pP3N2/Pn1Q4/1NK3RR b - - 7 28"
    },
    {
      "game": 1,
      "opening": "Unknown",
      "move": "22. f2",
      "best_move": "Bxb1",
      "cp_loss": 381,
      "phase": "middlegame",
      "fen": "r2qr3/1p3pkp/3p1nP1/3P1b2/2P5/pPN2p2/Pn1Q4/1BKR2NR b - - 2 22"
    },
    {
      "game": 1,
      "opening": "Unknown",
      "move": "27. Ng4",
      "best_move": "Nxd1",
      "cp_loss": 341,
      "phase": "middlegame",
      "fen": "r7/1p2q1kp/3p1np1/3P4/2P1r3/pP3N2/Pn1Q4/1NKR3R b - - 5 27"
    },
    {
      "game": 1,
      "opening": "Unknown",
      "move": "29. Kf7",
      "best_move": "Kg8",
      "cp_loss": 314,
      "phase": "middlegame",
      "fen": "r7/1p2q1kp/3p2pQ/3Pn3/2P1r3/pP3N2/Pn6/1NK3RR b - - 9 29"
    }
  ],
  "sample_mistakes": [
    {
      "game": 1,
      "move": "6. Re8",
      "best_move": "Ng4",
      "cp_loss": 159,
      "phase": "opening"
    },
    {
      "game": 1,
      "move": "7. e5",
      "best_move": "Ng4",
      "cp_loss": 138,
      "phase": "opening"
    },
    {
      "game": 1,
      "move": "9. a5",
      "best_move": "Ng4",
      "cp_loss": 153,
      "phase": "opening"
    },
    {
      "game": 1,
      "move": "13. Nc5",
      "best_move": "Ne5",
      "cp_loss": 174,
      "phase": "opening"
    },
    {
      "game": 1,
      "move": "15. a3",
      "best_move": "Bxh6",
      "cp_loss": 124,
      "phase": "opening"
    },
    {
      "game": 1,
      "move": "16. Nd3+",
      "best_move": "Bxh6",
      "cp_loss": 188,
      "phase": "middlegame"
    },
    {
      "game": 1,
      "move": "17. Nb2",
      "best_move": "Bxh6",
      "cp_loss": 217,
      "phase": "middlegame"
    },
    {
      "game": 1,
      "move": "20. Bxg4",
      "best_move": "Nxd1",
      "cp_loss": 151,
      "phase": "middlegame"
    },
    {
      "game": 1,
      "move": "24. fxg6",
      "best_move": "Nxd1",
      "cp_loss": 156,
      "phase": "middlegame"
    },
    {
      "game": 1,
      "move": "37. Nc2+",
      "best_move": "Rd8",
      "cp_loss": 209,
      "phase": "endgame"
    }
  ],
  "per_game": [
    {
      "game": 1,
      "vs": "Kulio54",
      "result": "1-0",
      "opening": "Unknown",
      "eco": "E70",
      "blunders": 7,
      "mistakes": 14,
      "inaccuracies": 10
    }
  ]
}
```

</details>
