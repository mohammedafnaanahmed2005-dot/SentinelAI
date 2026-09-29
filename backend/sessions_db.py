"""
SentinelAI Login / Logout Session Store.

Attendance-style session tracking kept in its own module (separate from the
core database.py schema) so it can evolve independently.

Each row records: user name, email, role, location (city label + lat/lng),
login_time, logout_time and the facial verification result for that login.
"""

import secrets
import datetime
from typing import Dict, Any, List, Optional

from .database import get_connection


def init_sessions_table() -> None:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_token TEXT UNIQUE NOT NULL,
        user_name TEXT,
        email TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        location TEXT,
        latitude REAL,
        longitude REAL,
        login_time TEXT NOT NULL,
        logout_time TEXT,
        face_similarity REAL DEFAULT 0.0,
        face_verified INTEGER DEFAULT 0,
        risk_score REAL DEFAULT 0.0,
        status TEXT DEFAULT 'ACTIVE'
    )
    """)
    conn.commit()
    conn.close()


def create_session(email: str, user_name: str, role: str, location: str,
                   latitude: float, longitude: float, face_similarity: float,
                   face_verified: bool, risk_score: float) -> Dict[str, Any]:
    token = secrets.token_hex(16)
    login_time = datetime.datetime.now().isoformat()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO sessions (
        session_token, user_name, email, role, location, latitude, longitude,
        login_time, logout_time, face_similarity, face_verified, risk_score, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'ACTIVE')
    """, (
        token, user_name, (email or "").lower(), role, location,
        latitude, longitude, login_time,
        float(face_similarity or 0.0), 1 if face_verified else 0, float(risk_score or 0.0)
    ))
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"session_token": token, "session_id": session_id, "login_time": login_time}


def close_session(token: str) -> bool:
    if not token:
        return False
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE sessions
    SET logout_time = ?, status = 'CLOSED'
    WHERE session_token = ? AND status = 'ACTIVE'
    """, (datetime.datetime.now().isoformat(), token))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def get_session_by_token(token: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sessions WHERE session_token = ?", (token,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_sessions(limit: int = 100, email: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    if email:
        cursor.execute(
            "SELECT * FROM sessions WHERE LOWER(email) = LOWER(?) ORDER BY id DESC LIMIT ?",
            (email, limit)
        )
    else:
        cursor.execute("SELECT * FROM sessions ORDER BY id DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


init_sessions_table()
