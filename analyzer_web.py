"""
Extended analyzer for the Flask web app.
Produces per-move evaluation data + structured AI sections.
"""

import io
import json
import math
import os
from typing import Callable, Optional

import chess
import chess.pgn
import chess.engine
import anthropic

BLUNDER_CP = 300
MISTAKE_CP = 100
INACCURACY_CP = 50
MATE_SCORE = 10_000
DEFAULT_DEPTH = 15
ENGINE_THREADS = 2
ENGINE_HASH_MB = 256


def _score_cp(pov_score: chess.engine.PovScore) -> int:
    s = pov_score.white()
    if s.is_mate():
        m = s.mate() or 0
        return MATE_SCORE if m > 0 else -MATE_SCORE
    return s.score() or 0


def _classify(cp_loss: int) -> str:
    if cp_loss >= BLUNDER_CP:
        return "blunder"
    if cp_loss >= MISTAKE_CP:
        return "mistake"
    if cp_loss >= INACCURACY_CP:
        return "inaccuracy"
    return "good"


def _eval_display(cp: int) -> str:
    if cp >= MATE_SCORE:
        return "M+"
    if cp <= -MATE_SCORE:
        return "M-"
    return f"{cp / 100:+.2f}"


def _eval_bar_pct(cp: int) -> int:
    """White winning percentage 3-97 for CSS bar."""
    clamped = max(-MATE_SCORE, min(MATE_SCORE, cp))
    pct = 50 + 50 * math.tanh(clamped / 400)
    return max(3, min(97, round(pct)))


def _accuracy_score(moves_data: list) -> int:
    user_moves = [m for m in moves_data if m["is_user_move"] and m["move_san"]]
    if not user_moves:
        return 100
    avg_loss = sum(m["cp_loss"] for m in user_moves) / len(user_moves)
    return max(0, min(100, round(100 - avg_loss / 8)))


def run_full_analysis(
    pgn_text: str,
    user_color_str: str,
    stockfish_path: str,
    memory: dict,
    progress_cb: Optional[Callable] = None,
) -> dict:

    def progress(pct: int, text: str):
        if progress_cb:
            progress_cb(pct, text)

    progress(5, "Parsing PGN…")
    buf = io.StringIO(pgn_text)
    game = chess.pgn.read_game(buf)
    if not game:
        raise ValueError("No valid PGN game found")

    user_color = chess.WHITE if user_color_str.lower() in ("white", "w") else chess.BLACK
    h = game.headers
    moves_list = list(game.mainline_moves())
    total_moves = len(moves_list)

    progress(10, f"Stockfish analyzing {total_moves} moves…")

    # positions[i] = (fen_before_move_i, eval_cp, best_san, best_uci)
    positions: list[tuple[str, int, Optional[str], Optional[str]]] = []

    with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
        engine.configure({"Threads": ENGINE_THREADS, "Hash": ENGINE_HASH_MB})
        board = game.board()

        for i in range(len(moves_list) + 1):
            pct = 10 + int(78 * i / max(total_moves, 1))
            if i < total_moves:
                progress(pct, f"Analyzing position {i + 1}/{total_moves}…")
            else:
                progress(88, "Analyzing final position…")

            info = engine.analyse(board, chess.engine.Limit(depth=DEFAULT_DEPTH))
            cp = _score_cp(info["score"])
            best_san = best_uci = None
            if "pv" in info and info["pv"]:
                best_uci = info["pv"][0].uci()
                try:
                    best_san = board.san(info["pv"][0])
                except Exception:
                    pass
            positions.append((board.fen(), cp, best_san, best_uci))

            if i < total_moves:
                board.push(moves_list[i])

    progress(89, "Building move-by-move data…")

    # Build moves_data: index 0 = start, index i+1 = after move i
    moves_data: list[dict] = [{
        "index": 0,
        "fen": positions[0][0],
        "fen_before": positions[0][0],
        "move_san": None,
        "move_uci": None,
        "move_number": 0,
        "mover": None,
        "eval_cp": positions[0][1],
        "eval_display": _eval_display(positions[0][1]),
        "eval_bar_pct": _eval_bar_pct(positions[0][1]),
        "classification": None,
        "cp_loss": 0,
        "best_move_san": positions[0][2],
        "best_move_uci": positions[0][3],
        "is_user_move": False,
        "explanation": "Starting position",
    }]

    board = game.board()
    for i, move in enumerate(moves_list):
        mover_color = chess.WHITE if i % 2 == 0 else chess.BLACK
        mover = "white" if mover_color == chess.WHITE else "black"
        is_user = mover_color == user_color
        move_num = i // 2 + 1

        san = board.san(move)
        uci = move.uci()

        cp_before = positions[i][1]
        cp_after = positions[i + 1][1]

        if mover_color == chess.WHITE:
            cp_loss = max(0, cp_before - cp_after)
        else:
            cp_loss = max(0, cp_after - cp_before)  # black wants cp to go down

        classification = _classify(cp_loss) if is_user else "opponent"

        # Best move for the position BEFORE this move was played
        best_san = positions[i][2]
        best_uci = positions[i][3]
        if best_uci == uci:
            best_san = best_uci = None  # played the best move already

        board.push(move)

        moves_data.append({
            "index": i + 1,
            "fen": positions[i + 1][0],
            "fen_before": positions[i][0],
            "move_san": san,
            "move_uci": uci,
            "move_number": move_num,
            "mover": mover,
            "eval_cp": cp_after,
            "eval_display": _eval_display(cp_after),
            "eval_bar_pct": _eval_bar_pct(cp_after),
            "classification": classification,
            "cp_loss": cp_loss if is_user else 0,
            "best_move_san": best_san,
            "best_move_uci": best_uci,
            "is_user_move": is_user,
            "explanation": "",
        })

    accuracy = _accuracy_score(moves_data)
    opening = h.get("Opening", h.get("ECOUrl", "Unknown Opening"))
    eco = h.get("ECO", "?")

    blunders = [m for m in moves_data if m["classification"] == "blunder"]
    mistakes = [m for m in moves_data if m["classification"] == "mistake"]
    inaccuracies = [m for m in moves_data if m["classification"] == "inaccuracy"]
    opening_errors = [m for m in moves_data
                      if m["is_user_move"] and m["move_number"] <= 15
                      and m["classification"] in ("blunder", "mistake", "inaccuracy")]

    summary = {
        "total_blunders": len(blunders),
        "total_mistakes": len(mistakes),
        "total_inaccuracies": len(inaccuracies),
        "total_moves": total_moves,
        "opening": opening,
        "eco": eco,
        "result": h.get("Result", "*"),
        "white": h.get("White", "?"),
        "black": h.get("Black", "?"),
        "date": h.get("Date", "?"),
        "accuracy_score": accuracy,
        "worst_blunders": sorted(
            [{"move_number": m["move_number"], "move": m["move_san"],
              "best_move": m["best_move_san"], "cp_loss": m["cp_loss"],
              "fen": m["fen_before"]} for m in blunders],
            key=lambda x: x["cp_loss"], reverse=True
        )[:5],
        "opening_errors": [
            {"move_number": m["move_number"], "move": m["move_san"],
             "best_move": m["best_move_san"], "cp_loss": m["cp_loss"]}
            for m in opening_errors[:5]
        ],
    }

    progress(91, "Generating AI report with Claude…")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            client = anthropic.Anthropic(api_key=api_key)
            sections = _generate_structured_report(client, summary, user_color_str, h, moves_data, memory)
        except Exception as exc:
            print(f"Claude API error: {exc}")
            sections = _fallback_sections(summary, user_color_str)
    else:
        sections = _fallback_sections(summary, user_color_str)

    _inject_explanations(moves_data, sections)

    progress(99, "Done!")
    return {
        "summary": summary,
        "moves": moves_data,
        "sections": sections,
        "game_info": {
            "white": h.get("White", "?"),
            "black": h.get("Black", "?"),
            "result": h.get("Result", "*"),
            "date": h.get("Date", "?"),
            "opening": opening,
            "eco": eco,
            "user_color": user_color_str,
            "total_moves": total_moves,
            "accuracy": accuracy,
        },
    }


def _inject_explanations(moves_data: list, sections: dict):
    lookup: dict[int, str] = {}
    for m in sections.get("middlegame_analysis", {}).get("critical_mistakes", []):
        mn = m.get("move_number")
        if mn:
            lookup[mn] = m.get("explanation", "")

    for m in moves_data:
        if not m["move_san"]:
            continue
        mn = m["move_number"]
        cls = m["classification"]
        if mn in lookup:
            m["explanation"] = lookup[mn]
        elif cls == "blunder":
            best = m["best_move_san"] or "a different move"
            m["explanation"] = f"Blunder — lost {m['cp_loss'] / 100:.1f} pawns. Best was {best}."
        elif cls == "mistake":
            best = m["best_move_san"] or "a better move"
            m["explanation"] = f"Mistake — lost {m['cp_loss'] / 100:.1f} pawns. Consider {best} instead."
        elif cls == "inaccuracy":
            best = m["best_move_san"] or "a slightly better move"
            m["explanation"] = f"Minor inaccuracy ({m['cp_loss'] / 100:.1f} pawns). {best} was stronger."
        elif cls == "good":
            m["explanation"] = "Good move!"
        else:
            m["explanation"] = ""


_REPORT_PROMPT = """\
You are an expert chess coach. Analyze the game data below and return a single JSON object.
Be specific — reference actual moves, move numbers, and positions from the data.

Game Data:
{data}

Player Memory (past patterns from previous games):
{memory}

Return ONLY valid JSON with this exact structure (no markdown, no extra text):
{{
  "game_summary": {{
    "result_narrative": "2 sentences about game result and overall play quality",
    "total_moves": <integer>,
    "accuracy_score": <integer 0-100>,
    "key_strength": "One thing the player did well",
    "key_weakness": "Main weakness that hurt them"
  }},
  "opening_theory": {{
    "opening_name": "Full opening name and variation",
    "eco": "ECO code",
    "book_until_move": <integer>,
    "deviation_move": "The move number and SAN where they left theory, e.g. '13...Nd7'",
    "correct_book_move": "What theory recommends instead",
    "deviation_explanation": "Why the deviation was problematic (1-2 sentences)",
    "lines_to_study": [
      {{"name": "Line name", "description": "What concept to study", "resource": "Specific book or website"}},
      {{"name": "Line name", "description": "What to study", "resource": "Specific resource"}},
      {{"name": "Line name", "description": "What to study", "resource": "Specific resource"}}
    ]
  }},
  "middlegame_analysis": {{
    "critical_mistakes": [
      {{
        "move_number": <integer>,
        "move_played": "SAN",
        "best_move": "SAN",
        "cp_loss": <integer>,
        "classification": "blunder|mistake",
        "explanation": "2-3 sentences: what happened, why it was bad, what the correct plan was",
        "concept_missed": "The chess concept (e.g. Back-rank weakness, Knight fork on d5)"
      }}
    ],
    "tactical_patterns_missed": [
      {{"pattern": "Pattern type", "description": "Specific example from this game"}}
    ]
  }},
  "endgame_analysis": {{
    "reached_endgame": <true|false>,
    "endgame_type": "Type of endgame if applicable, else null",
    "technique_errors": ["specific error 1", "specific error 2"],
    "key_concepts": ["concept to study 1", "concept to study 2"]
  }},
  "improvement_plan": [
    {{"priority": 1, "area": "Area", "recommendation": "Specific action", "resource": "Book/site/tool", "why": "Why this is #1 based on THIS game"}},
    {{"priority": 2, "area": "Area", "recommendation": "Specific action", "resource": "Resource", "why": "Reason"}},
    {{"priority": 3, "area": "Area", "recommendation": "Specific action", "resource": "Resource", "why": "Reason"}},
    {{"priority": 4, "area": "Area", "recommendation": "Specific action", "resource": "Resource", "why": "Reason"}},
    {{"priority": 5, "area": "Area", "recommendation": "Specific action", "resource": "Resource", "why": "Reason"}}
  ]
}}"""


def _generate_structured_report(
    client: anthropic.Anthropic,
    summary: dict,
    user_color: str,
    headers,
    moves_data: list,
    memory: dict,
) -> dict:
    data = {
        "user_color": user_color,
        "white": headers.get("White", "?"),
        "black": headers.get("Black", "?"),
        "result": headers.get("Result", "*"),
        "opening": headers.get("Opening", summary.get("opening", "?")),
        "eco": headers.get("ECO", "?"),
        "total_moves": summary["total_moves"],
        "blunders": summary["total_blunders"],
        "mistakes": summary["total_mistakes"],
        "inaccuracies": summary["total_inaccuracies"],
        "accuracy_score": summary["accuracy_score"],
        "worst_blunders": summary["worst_blunders"],
        "opening_errors": summary.get("opening_errors", []),
        "all_errors": [
            {"move_number": m["move_number"], "move": m["move_san"],
             "best": m["best_move_san"], "cp_loss": m["cp_loss"],
             "classification": m["classification"]}
            for m in moves_data
            if m["is_user_move"] and m["classification"] in ("blunder", "mistake", "inaccuracy")
        ],
    }
    mem_ctx = {
        "games_analyzed": memory.get("games_analyzed", 0),
        "recurring_opening_gaps": [g["opening"] for g in memory.get("opening_gaps", [])[:3]],
        "improvement_areas": memory.get("improvement_areas", [])[:5],
        "recent_trend": memory.get("performance_trend", [])[-3:],
    }

    prompt = _REPORT_PROMPT.format(
        data=json.dumps(data, indent=2),
        memory=json.dumps(mem_ctx, indent=2),
    )

    msg = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=4096,
        system=[{
            "type": "text",
            "text": "You are an expert chess coach. Return only valid JSON, no markdown fences.",
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": prompt}],
    )

    text = msg.content[0].text.strip()
    # Strip markdown code fences if model added them
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(text)


def _fallback_sections(summary: dict, user_color: str) -> dict:
    result = summary.get("result", "*")
    won = (user_color == "white" and result == "1-0") or (user_color == "black" and result == "0-1")
    result_text = "won" if won else ("drew" if "1/2" in result else "lost")
    tm = summary.get("total_moves", 0)
    return {
        "game_summary": {
            "result_narrative": f"You {result_text} this {tm}-move game.",
            "total_moves": tm,
            "accuracy_score": summary.get("accuracy_score", 0),
            "key_strength": "N/A — enable ANTHROPIC_API_KEY for AI analysis",
            "key_weakness": f"{summary['total_blunders']} blunder(s), {summary['total_mistakes']} mistake(s)",
        },
        "opening_theory": {
            "opening_name": summary.get("opening", "Unknown"),
            "eco": summary.get("eco", "?"),
            "book_until_move": 0,
            "deviation_move": "N/A",
            "correct_book_move": "Set ANTHROPIC_API_KEY for opening analysis",
            "deviation_explanation": "",
            "lines_to_study": [],
        },
        "middlegame_analysis": {
            "critical_mistakes": [
                {"move_number": b["move_number"], "move_played": b["move"],
                 "best_move": b.get("best_move") or "?", "cp_loss": b["cp_loss"],
                 "classification": "blunder",
                 "explanation": f"Lost {b['cp_loss'] / 100:.1f} pawns of advantage.",
                 "concept_missed": "Tactical oversight"}
                for b in summary.get("worst_blunders", [])[:3]
            ],
            "tactical_patterns_missed": [],
        },
        "endgame_analysis": {
            "reached_endgame": tm > 35,
            "endgame_type": None,
            "technique_errors": [],
            "key_concepts": [],
        },
        "improvement_plan": [
            {"priority": 1, "area": "Tactics", "recommendation": "Do 20 puzzles daily",
             "resource": "lichess.org/training", "why": "Reduce blunder rate"},
        ],
    }
