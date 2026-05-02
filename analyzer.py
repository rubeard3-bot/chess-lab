#!/usr/bin/env python3
"""
Chess game analyzer — paste or load a PGN and get a personalized improvement report.

Usage:
    python analyzer.py game.pgn --color white
    python analyzer.py game.pgn --color black --output report.md
    python analyzer.py --stdin --color white        (then paste PGN, press Ctrl+Z + Enter)
    python analyzer.py --no-claude game.pgn         (raw stats only, no AI report)

Setup:
    pip install python-chess anthropic
    Download Stockfish: https://stockfishchess.org/download/
    Set env var: ANTHROPIC_API_KEY=sk-ant-...
"""

import sys
import os
import io
import json
import argparse
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

import chess
import chess.pgn
import chess.engine
import anthropic

# ── Thresholds ───────────────────────────────────────────────────────────────
BLUNDER_CP    = 300
MISTAKE_CP    = 100
INACCURACY_CP = 50
MATE_SCORE    = 30_000  # sentinel for mate-in-N evals

# ── Game phases (by full move number) ────────────────────────────────────────
OPENING_END    = 15
MIDDLEGAME_END = 35

# ── Engine defaults ───────────────────────────────────────────────────────────
DEFAULT_DEPTH  = 15
ENGINE_THREADS = 2
ENGINE_HASH_MB = 256


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class MoveError:
    move_number: int
    san: str
    best_san: Optional[str]
    cp_loss: int
    classification: str  # blunder | mistake | inaccuracy
    phase: str           # opening | middlegame | endgame
    fen: str             # position BEFORE the move was played


@dataclass
class GameReport:
    game_number: int
    white: str
    black: str
    result: str
    date: str
    opening: str
    eco: str
    user_color: str
    errors: list[MoveError] = field(default_factory=list)

    def by_phase(self, phase: str) -> list[MoveError]:
        return [e for e in self.errors if e.phase == phase]

    def by_class(self, cls: str) -> list[MoveError]:
        return [e for e in self.errors if e.classification == cls]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _phase(move_number: int) -> str:
    if move_number <= OPENING_END:
        return "opening"
    if move_number <= MIDDLEGAME_END:
        return "middlegame"
    return "endgame"


def _classify(cp_loss: int) -> str:
    if cp_loss >= BLUNDER_CP:
        return "blunder"
    if cp_loss >= MISTAKE_CP:
        return "mistake"
    return "inaccuracy"


def _score_cp(pov_score: chess.engine.PovScore) -> Optional[int]:
    """Centipawns from White's perspective, capped at ±MATE_SCORE for mates."""
    s = pov_score.white()
    if s.is_mate():
        return MATE_SCORE if (s.mate() or 0) > 0 else -MATE_SCORE
    return s.score()


def find_stockfish() -> Optional[str]:
    candidates = [
        "stockfish",
        "stockfish.exe",
        r"C:\stockfish\stockfish.exe",
        r"C:\stockfish\stockfish-windows-x86-64-avx2.exe",
        r"C:\Program Files\Stockfish\stockfish.exe",
        "/usr/bin/stockfish",
        "/usr/local/bin/stockfish",
        "/opt/homebrew/bin/stockfish",
    ]
    for path in candidates:
        try:
            with chess.engine.SimpleEngine.popen_uci(path) as e:
                return path
        except Exception:
            continue
    return None


# ── Core analysis ─────────────────────────────────────────────────────────────

def analyze_game(
    game: chess.pgn.Game,
    engine: chess.engine.SimpleEngine,
    user_color: chess.Color,
    game_number: int,
    depth: int,
) -> GameReport:
    h = game.headers
    report = GameReport(
        game_number=game_number,
        white=h.get("White", "?"),
        black=h.get("Black", "?"),
        result=h.get("Result", "*"),
        date=h.get("Date", "?"),
        opening=h.get("Opening", h.get("ECOUrl", "Unknown")),
        eco=h.get("ECO", "?"),
        user_color="white" if user_color == chess.WHITE else "black",
    )

    moves = list(game.mainline_moves())
    if not moves:
        return report

    # Evaluate every position in the game (before each move + final position).
    # This gives us eval[i] before move i and eval[i+1] after move i.
    board = game.board()
    evals: list[tuple[Optional[int], Optional[str]]] = []  # (cp, best_move_san)

    for i in range(len(moves) + 1):
        info = engine.analyse(board, chess.engine.Limit(depth=depth))
        cp = _score_cp(info["score"])
        bm: Optional[str] = None
        if "pv" in info and info["pv"]:
            try:
                bm = board.san(info["pv"][0])
            except Exception:
                pass
        evals.append((cp, bm))
        if i < len(moves):
            board.push(moves[i])

    # Walk through moves and record the user's errors.
    board = game.board()
    for i, move in enumerate(moves):
        mover = chess.WHITE if i % 2 == 0 else chess.BLACK
        san = board.san(move)

        if mover == user_color:
            cp_before, best_san = evals[i]
            cp_after, _ = evals[i + 1]

            if cp_before is not None and cp_after is not None:
                # Positive cp_loss = user lost ground.
                if user_color == chess.WHITE:
                    cp_loss = max(0, cp_before - cp_after)
                else:
                    cp_loss = max(0, cp_after - cp_before)

                if cp_loss >= INACCURACY_CP:
                    move_num = i // 2 + 1
                    report.errors.append(MoveError(
                        move_number=move_num,
                        san=san,
                        best_san=best_san if best_san != san else None,
                        cp_loss=cp_loss,
                        classification=_classify(cp_loss),
                        phase=_phase(move_num),
                        fen=board.fen(),
                    ))

        board.push(move)

    return report


# ── Summary builder ───────────────────────────────────────────────────────────

def build_summary(reports: list[GameReport]) -> dict:
    def count(cls: str) -> int:
        return sum(len(r.by_class(cls)) for r in reports)

    def phase_breakdown(phase: str) -> dict:
        return {
            "blunders":     sum(len([e for e in r.by_phase(phase) if e.classification == "blunder"])     for r in reports),
            "mistakes":     sum(len([e for e in r.by_phase(phase) if e.classification == "mistake"])     for r in reports),
            "inaccuracies": sum(len([e for e in r.by_phase(phase) if e.classification == "inaccuracy"]) for r in reports),
        }

    wins   = sum(1 for r in reports if (r.user_color == "white" and r.result == "1-0") or (r.user_color == "black" and r.result == "0-1"))
    draws  = sum(1 for r in reports if r.result == "1/2-1/2")
    losses = len(reports) - wins - draws

    # Opening inventory
    openings_played: dict[str, int] = {}
    for r in reports:
        key = f"{r.eco} — {r.opening}" if r.eco not in ("?", "") else r.opening
        openings_played[key] = openings_played.get(key, 0) + 1

    # Opening errors (mistakes/blunders in the first OPENING_END moves)
    opening_errors = []
    for r in reports:
        for e in r.by_phase("opening"):
            if e.classification in ("blunder", "mistake"):
                opening_errors.append({
                    "game":         r.game_number,
                    "opening_name": r.opening,
                    "eco":          r.eco,
                    "move":         f"{e.move_number}. {e.san}",
                    "best_move":    e.best_san,
                    "cp_loss":      e.cp_loss,
                })

    # Worst blunders across all games
    all_blunders = sorted(
        [
            {
                "game":      r.game_number,
                "opening":   r.opening,
                "move":      f"{e.move_number}. {e.san}",
                "best_move": e.best_san,
                "cp_loss":   e.cp_loss,
                "phase":     e.phase,
                "fen":       e.fen,
            }
            for r in reports for e in r.by_class("blunder")
        ],
        key=lambda x: x["cp_loss"],
        reverse=True,
    )

    sample_mistakes = [
        {
            "game":      r.game_number,
            "move":      f"{e.move_number}. {e.san}",
            "best_move": e.best_san,
            "cp_loss":   e.cp_loss,
            "phase":     e.phase,
        }
        for r in reports for e in r.by_class("mistake")
    ]

    return {
        "total_games": len(reports),
        "results": {"wins": wins, "draws": draws, "losses": losses},
        "total_blunders":     count("blunder"),
        "total_mistakes":     count("mistake"),
        "total_inaccuracies": count("inaccuracy"),
        "avg_blunders_per_game": round(count("blunder") / len(reports), 2) if reports else 0,
        "avg_mistakes_per_game": round(count("mistake") / len(reports), 2) if reports else 0,
        "errors_by_phase": {
            "opening":    phase_breakdown("opening"),
            "middlegame": phase_breakdown("middlegame"),
            "endgame":    phase_breakdown("endgame"),
        },
        "openings_played": openings_played,
        "opening_errors":  opening_errors[:12],
        "worst_blunders":  all_blunders[:10],
        "sample_mistakes": sample_mistakes[:10],
        "per_game": [
            {
                "game":        r.game_number,
                "vs":          r.black if r.user_color == "white" else r.white,
                "result":      r.result,
                "opening":     r.opening,
                "eco":         r.eco,
                "blunders":    len(r.by_class("blunder")),
                "mistakes":    len(r.by_class("mistake")),
                "inaccuracies":len(r.by_class("inaccuracy")),
            }
            for r in reports
        ],
    }


# ── Claude report ─────────────────────────────────────────────────────────────

COACH_SYSTEM = """You are an expert chess coach with 20+ years of experience working with club players up to national tournament level. You provide deeply personalized improvement advice grounded in the player's actual game data. Your reports are:
- Specific: reference the player's exact moves, openings, and errors — never generic filler
- Constructive: explain WHY a move was wrong and WHAT the correct idea was
- Actionable: name concrete resources (books, Lichess studies, YouTube channels, puzzle types)
- Encouraging but honest: acknowledge strengths while being direct about weaknesses"""


def generate_ai_report(summary: dict, client: anthropic.Anthropic, user_color: str) -> str:
    data_json = json.dumps(summary, indent=2)

    user_msg = f"""Here is Stockfish analysis data for a chess player who plays as {user_color}. Analyze it and write a personalized improvement report.

{data_json}

Structure your report with these sections:

## Performance Overview
Win/loss record, average errors per game, and the most notable trend.

## Opening Analysis
Which openings does this player use? Where do they deviate from sound theory? (Reference the opening_errors and openings_played data.) What specific opening systems or concepts should they study next? Name the opening, the key idea they're missing, and a concrete way to learn it.

## Tactical Weaknesses
What types of errors dominate (blunders vs mistakes vs inaccuracies)? Which game phase has the most errors? Based on the move data, what tactical patterns are they likely missing — forks, pins, back-rank threats, missed checkmates? Be specific.

## Critical Moments Breakdown
Walk through 2–3 of their worst blunders from worst_blunders. For each: explain the position, what they played, what was better, and the key concept they missed.

## Your Improvement Plan
Give 5 specific, prioritized recommendations:
1. A tactical drill or puzzle type (with a specific platform/tool)
2. An opening to study or tighten (with a resource)
3. A middlegame concept to work on
4. An endgame area if relevant
5. A mental habit or decision-making improvement

Keep the tone direct and practical. Reference the actual data throughout — this player wants analysis of their games, not generic chess advice."""

    msg = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=4096,
        system=[
            {
                "type": "text",
                "text": COACH_SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_msg}],
    )
    return msg.content[0].text


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze your chess games and get a personalized improvement report.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("pgn", nargs="?", help="Path to a .pgn file")
    parser.add_argument("--stdin", action="store_true", help="Read PGN from stdin (paste mode)")
    parser.add_argument(
        "--color", choices=["white", "black", "w", "b"],
        help="Your color in the games (prompted if omitted)",
    )
    parser.add_argument("--stockfish", metavar="PATH", help="Path to Stockfish binary")
    parser.add_argument(
        "--depth", type=int, default=DEFAULT_DEPTH,
        help=f"Engine analysis depth (default: {DEFAULT_DEPTH}). Higher = slower but more accurate.",
    )
    parser.add_argument(
        "--max-games", type=int, default=20,
        help="Max games to analyze from the PGN (default: 20)",
    )
    parser.add_argument("--output", metavar="FILE", help="Save report to a .md file")
    parser.add_argument(
        "--no-claude", action="store_true",
        help="Skip AI report, print raw statistics only (no ANTHROPIC_API_KEY needed)",
    )
    args = parser.parse_args()

    # ── Load PGN ──────────────────────────────────────────────────────────────
    if args.stdin or not args.pgn:
        if not args.stdin:
            print("Paste your PGN below, then press Ctrl+Z + Enter (Windows) or Ctrl+D (Unix):\n")
        pgn_text = sys.stdin.read()
    else:
        p = Path(args.pgn)
        if not p.exists():
            sys.exit(f"Error: file not found — {args.pgn}")
        pgn_text = p.read_text(encoding="utf-8", errors="replace")

    if not pgn_text.strip():
        sys.exit("Error: no PGN content provided.")

    # ── Parse games ───────────────────────────────────────────────────────────
    games: list[chess.pgn.Game] = []
    buf = io.StringIO(pgn_text)
    while len(games) < args.max_games:
        g = chess.pgn.read_game(buf)
        if g is None:
            break
        games.append(g)

    if not games:
        sys.exit("Error: no valid PGN games found.")

    print(f"Loaded {len(games)} game(s).")

    # ── Determine user color ───────────────────────────────────────────────────
    color_map = {"white": chess.WHITE, "w": chess.WHITE, "black": chess.BLACK, "b": chess.BLACK}
    if args.color:
        user_color = color_map[args.color]
    else:
        h = games[0].headers
        print(f"\nGame 1:  White — {h.get('White', '?')}   Black — {h.get('Black', '?')}")
        raw = input("Which color are you playing? [w/b]: ").strip().lower()
        user_color = chess.WHITE if raw.startswith("w") else chess.BLACK

    user_color_str = "white" if user_color == chess.WHITE else "black"

    # ── Find Stockfish ─────────────────────────────────────────────────────────
    sf_path = args.stockfish or find_stockfish()
    if not sf_path:
        sys.exit(
            "\nError: Stockfish not found.\n"
            "  1. Download from https://stockfishchess.org/download/\n"
            "  2. Either add it to your PATH or use --stockfish <path>\n"
        )

    # ── Analyze games ──────────────────────────────────────────────────────────
    print(f"\nRunning Stockfish analysis at depth {args.depth} — this may take a few minutes...\n")
    reports: list[GameReport] = []

    with chess.engine.SimpleEngine.popen_uci(sf_path) as engine:
        engine.configure({"Threads": ENGINE_THREADS, "Hash": ENGINE_HASH_MB})
        for i, game in enumerate(games):
            n = i + 1
            h = game.headers
            label = f"[{n}/{len(games)}] {h.get('White','?')} vs {h.get('Black','?')}  ({h.get('Result','*')})"
            print(f"  {label} ...", end="", flush=True)
            try:
                r = analyze_game(game, engine, user_color, n, args.depth)
                reports.append(r)
                b = len(r.by_class("blunder"))
                m = len(r.by_class("mistake"))
                i_ = len(r.by_class("inaccuracy"))
                print(f"  {b} blunder(s), {m} mistake(s), {i_} inaccuracy(ies)")
            except Exception as exc:
                print(f"  SKIPPED ({exc})")

    if not reports:
        sys.exit("No games could be analyzed.")

    summary = build_summary(reports)

    # ── Generate report ────────────────────────────────────────────────────────
    if args.no_claude:
        ai_section = "_AI report skipped (`--no-claude` flag set)._"
    else:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            sys.exit(
                "\nError: ANTHROPIC_API_KEY is not set.\n"
                "  Set it with:  set ANTHROPIC_API_KEY=sk-ant-...\n"
                "  Or use --no-claude to skip the AI report.\n"
            )
        print("\nGenerating personalized report with Claude AI...")
        client = anthropic.Anthropic(api_key=api_key)
        ai_section = generate_ai_report(summary, client, user_color_str)

    report_md = (
        "# Chess Analysis Report\n\n"
        + ai_section
        + "\n\n---\n\n"
        "<details>\n<summary>📊 Raw Statistics (click to expand)</summary>\n\n"
        f"```json\n{json.dumps(summary, indent=2)}\n```\n\n"
        "</details>\n"
    )

    # ── Output ─────────────────────────────────────────────────────────────────
    if args.output:
        out = Path(args.output)
        out.write_text(report_md, encoding="utf-8")
        print(f"\nReport saved to: {out.resolve()}")
    else:
        print("\n" + "=" * 72 + "\n")
        print(report_md)


if __name__ == "__main__":
    main()
