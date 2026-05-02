import sqlite3
import json
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent / "chess_games.db"


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT,
                pgn_text TEXT,
                user_color TEXT,
                white_player TEXT,
                black_player TEXT,
                result TEXT,
                opening TEXT,
                eco TEXT,
                accuracy INTEGER,
                blunders INTEGER,
                mistakes INTEGER,
                inaccuracies INTEGER,
                total_moves INTEGER,
                analyzed_at TEXT,
                analysis_json TEXT
            )
        """)
        conn.commit()


def save_game(filename, pgn_text, user_color, result):
    gi = result["game_info"]
    s = result["summary"]
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute("""
            INSERT INTO games (filename, pgn_text, user_color, white_player, black_player,
                result, opening, eco, accuracy, blunders, mistakes, inaccuracies,
                total_moves, analyzed_at, analysis_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            filename, pgn_text, user_color,
            gi["white"], gi["black"], gi["result"],
            gi["opening"], gi["eco"], gi["accuracy"],
            s["total_blunders"], s["total_mistakes"], s["total_inaccuracies"],
            gi["total_moves"],
            datetime.now().isoformat(),
            json.dumps(result)
        ))
        conn.commit()
        return cur.lastrowid


def get_game(game_id):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
        return dict(row) if row else None


def get_recent_games(limit=10):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, filename, white_player, black_player, result, opening, "
            "eco, accuracy, blunders, mistakes, inaccuracies, total_moves, analyzed_at "
            "FROM games ORDER BY id DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def delete_game(game_id):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()
