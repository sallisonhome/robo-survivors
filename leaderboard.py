#!/usr/bin/env python3
"""
ROBO SURVIVORS — Global Leaderboard API
Lightweight FastAPI server with JSON file storage.
Endpoints:
  GET  /api/scores        → returns top 75 scores (supports all 3 columns)
  POST /api/scores        → submit a new score
  GET  /api/scores/health → health check
"""

import json
import os
import time
import re
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

app = FastAPI(title="ROBO SURVIVORS Leaderboard")

# Allow requests from any origin (game is served from same domain via Nginx proxy)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Storage
SCORES_FILE = Path("/var/www/robosurvivors/scores.json")
MAX_SCORES = 200  # keep more than displayed for daily/weekly filtering

def load_scores():
    if SCORES_FILE.exists():
        try:
            with open(SCORES_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
    return []

def save_scores(scores):
    # Sort by score descending, keep top MAX_SCORES
    scores.sort(key=lambda s: s["score"], reverse=True)
    scores = scores[:MAX_SCORES]
    tmp = str(SCORES_FILE) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(scores, f)
    os.replace(tmp, str(SCORES_FILE))  # atomic write
    return scores


class ScoreSubmission(BaseModel):
    initials: str
    score: int
    wave: int = 1
    level: int = 1

    @field_validator("initials")
    @classmethod
    def validate_initials(cls, v):
        v = v.strip().upper()
        if not re.match(r'^[A-Z0-9]{1,3}$', v):
            raise ValueError("Initials must be 1-3 alphanumeric characters")
        return v

    @field_validator("score")
    @classmethod
    def validate_score(cls, v):
        if v < 0 or v > 999_999_999:
            raise ValueError("Invalid score")
        return v


@app.get("/api/scores")
def get_scores():
    """Return all stored scores (client handles filtering/display)."""
    scores = load_scores()
    return {"scores": scores}


@app.post("/api/scores")
def submit_score(submission: ScoreSubmission):
    """Submit a new high score."""
    scores = load_scores()

    entry = {
        "initials": submission.initials,
        "score": submission.score,
        "wave": submission.wave,
        "level": submission.level,
        "timestamp": int(time.time() * 1000),  # milliseconds, matches JS Date.now()
    }

    scores.append(entry)
    scores = save_scores(scores)

    # Find rank (1-indexed)
    rank = next((i + 1 for i, s in enumerate(scores) if s["timestamp"] == entry["timestamp"] and s["score"] == entry["score"]), -1)

    return {"success": True, "rank": rank, "total": len(scores)}


@app.get("/api/scores/health")
def health():
    return {"status": "ok", "scores_count": len(load_scores())}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8090)
