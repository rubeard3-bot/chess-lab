import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, url_for

import chess_db
from analyzer_web import run_full_analysis

app = Flask(__name__)
app.secret_key = os.urandom(24)

STOCKFISH_PATH = r"C:\stockfish\stockfish\stockfish-windows-x86-64-avx2.exe"
MEMORY_FILE = Path(__file__).parent / "player_memory.json"

_jobs: dict = {}
_jobs_lock = threading.Lock()


# ── Memory helpers ────────────────────────────────────────────────────────────

def load_memory() -> dict:
    if MEMORY_FILE.exists():
        try:
            return json.loads(MEMORY_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "games_analyzed": 0,
        "last_updated": None,
        "opening_gaps": [],
        "tactical_weaknesses": {},
        "endgame_struggles": [],
        "performance_trend": [],
        "most_common_mistakes": [],
        "improvement_areas": [],
    }


def save_memory(memory: dict):
    MEMORY_FILE.write_text(json.dumps(memory, indent=2), encoding="utf-8")


def update_memory(memory: dict, result: dict) -> dict:
    memory["games_analyzed"] = memory.get("games_analyzed", 0) + 1
    memory["last_updated"] = datetime.now().isoformat()

    # Performance trend
    entry = {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "blunders": result["summary"]["total_blunders"],
        "mistakes": result["summary"]["total_mistakes"],
        "accuracy": result["sections"]["game_summary"].get("accuracy_score", 0),
        "opening": result["game_info"]["opening"],
    }
    trend = memory.setdefault("performance_trend", [])
    trend.append(entry)
    memory["performance_trend"] = trend[-20:]

    # Opening gaps
    for err in result["summary"].get("opening_errors", []):
        op_name = result["game_info"]["opening"]
        gaps = memory.setdefault("opening_gaps", [])
        gap = next((g for g in gaps if g["opening"] == op_name), None)
        if gap:
            gap["error_count"] = gap.get("error_count", 0) + 1
        else:
            gaps.append({"opening": op_name, "eco": result["game_info"]["eco"], "error_count": 1})
        break  # one entry per game

    # Improvement areas
    plan = result["sections"].get("improvement_plan", [])
    areas = memory.setdefault("improvement_areas", [])
    for item in plan[:3]:
        area = item.get("area", "")
        if area and area not in areas:
            areas.append(area)
    memory["improvement_areas"] = areas[-10:]

    # Most common mistakes from middlegame section
    mistakes_text = []
    for cm in result["sections"].get("middlegame_analysis", {}).get("critical_mistakes", []):
        concept = cm.get("concept_missed", "")
        if concept:
            mistakes_text.append(concept)
    existing = memory.setdefault("most_common_mistakes", [])
    for m in mistakes_text:
        if m not in existing:
            existing.append(m)
    memory["most_common_mistakes"] = existing[-15:]

    return memory


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    memory = load_memory()
    games = chess_db.get_recent_games(10)
    return render_template("index.html", memory=memory, games=games)


@app.route("/analyze", methods=["POST"])
def analyze():
    pgn_text = ""
    filename = "pasted_game.pgn"

    if "pgn_file" in request.files and request.files["pgn_file"].filename:
        f = request.files["pgn_file"]
        filename = f.filename
        pgn_text = f.read().decode("utf-8", errors="replace")
    else:
        pgn_text = request.form.get("pgn_text", "")

    if not pgn_text.strip():
        return jsonify({"error": "No PGN content provided"}), 400

    user_color = request.form.get("color", "white")
    job_id = str(uuid.uuid4())

    with _jobs_lock:
        _jobs[job_id] = {
            "status": "pending",
            "progress": 0,
            "progress_text": "Queued…",
            "game_id": None,
            "error": None,
        }

    t = threading.Thread(
        target=_run_job,
        args=(job_id, pgn_text, user_color, filename),
        daemon=True,
    )
    t.start()
    return jsonify({"job_id": job_id})


def _run_job(job_id: str, pgn_text: str, user_color: str, filename: str):
    def cb(pct: int, text: str):
        with _jobs_lock:
            _jobs[job_id]["progress"] = pct
            _jobs[job_id]["progress_text"] = text
            _jobs[job_id]["status"] = "running"

    try:
        memory = load_memory()
        result = run_full_analysis(pgn_text, user_color, STOCKFISH_PATH, memory, cb)
        game_id = chess_db.save_game(filename, pgn_text, user_color, result)
        updated = update_memory(memory, result)
        save_memory(updated)

        with _jobs_lock:
            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["progress"] = 100
            _jobs[job_id]["game_id"] = game_id

    except Exception as exc:
        import traceback
        traceback.print_exc()
        with _jobs_lock:
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["error"] = str(exc)


@app.route("/api/status/<job_id>")
def job_status(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route("/game/<int:game_id>")
def view_game(game_id):
    row = chess_db.get_game(game_id)
    if not row:
        return "Game not found", 404
    analysis = json.loads(row["analysis_json"])
    return render_template("analysis.html", row=row, analysis=analysis, game_id=game_id)


@app.route("/game/<int:game_id>/delete", methods=["POST"])
def delete_game(game_id):
    chess_db.delete_game(game_id)
    return redirect(url_for("index"))


@app.route("/api/memory")
def api_memory():
    return jsonify(load_memory())


if __name__ == "__main__":
    chess_db.init_db()
    print("Chess Analyzer running at http://localhost:5000")
    app.run(debug=True, port=5000, use_reloader=False)
