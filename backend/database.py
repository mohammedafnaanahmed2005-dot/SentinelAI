import sqlite3
import json
import hashlib
import os
import secrets
import datetime
from typing import Dict, Any, List, Optional

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sentinel_auth.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password: str) -> str:
    # SHA-256 with project salt for deterministic secure hashing
    salt = "SnapdragonSPU_Salt_2026#AI"
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        face_embedding TEXT, -- JSON array of floats (128-d SFace descriptor)
        enrolled_at TEXT,
        home_city TEXT DEFAULT 'San Francisco',
        home_lat REAL DEFAULT 37.7749,
        home_lng REAL DEFAULT -122.4194,
        base_typing_speed REAL DEFAULT 4.5, -- chars per second
        iris_verified INTEGER DEFAULT 1,
        is_blocked INTEGER DEFAULT 0
    )
    """)

    # 2. Security Policies Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS security_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_hour INTEGER DEFAULT 8,
        end_hour INTEGER DEFAULT 20,
        max_typing_seconds REAL DEFAULT 7.5,
        min_typing_seconds REAL DEFAULT 0.6,
        face_threshold REAL DEFAULT 0.55,
        max_geo_km REAL DEFAULT 60.0,
        risk_low_max REAL DEFAULT 30.0,
        risk_med_max REAL DEFAULT 70.0,
        require_iris INTEGER DEFAULT 1,
        snapdragon_tee_mode INTEGER DEFAULT 1,
        updated_at TEXT
    )
    """)

    # 3. Audit Logs Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        email TEXT NOT NULL,
        ip_address TEXT DEFAULT '127.0.0.1',
        city TEXT DEFAULT 'Unknown',
        latitude REAL,
        longitude REAL,
        risk_score REAL NOT NULL,
        risk_level TEXT NOT NULL,
        action_taken TEXT NOT NULL,
        face_similarity REAL,
        iris_detected INTEGER DEFAULT 1,
        typing_duration_sec REAL,
        time_anomaly_flag INTEGER DEFAULT 0,
        location_distance_km REAL DEFAULT 0.0,
        failure_reasons TEXT
    )
    """)

    # 4. OTP Tokens Table (for MFA / Ping Identity / OAuth style OTP)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS otp_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        risk_score REAL,
        is_used INTEGER DEFAULT 0
    )
    """)

    # Seed Default Security Policy if empty
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

    cursor.execute("SELECT COUNT(*) FROM security_policies")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
        INSERT INTO security_policies (
            start_hour, end_hour, max_typing_seconds, min_typing_seconds,
            face_threshold, max_geo_km, risk_low_max, risk_med_max,
            require_iris, snapdragon_tee_mode, updated_at
        ) VALUES (8, 20, 7.5, 0.6, 0.55, 60.0, 30.0, 70.0, 0, 1, ?)
        """, (datetime.datetime.utcnow().isoformat(),))

    # Seed the primary admin account if the registry is empty. Regular demo
    # users are NOT seeded - the admin registers real users from the admin page.
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        # The admin starts without a face template; the live face is enrolled
        # automatically on the first successful login (bootstrap).
        admin_pwd = hash_password("Admin@Cyber2026!")
        now = datetime.datetime.utcnow().isoformat()

        cursor.execute("""
        INSERT INTO users (email, password_hash, full_name, role, face_embedding, enrolled_at, home_city, home_lat, home_lng, base_typing_speed, iris_verified, is_blocked)
        VALUES (?, ?, ?, 'admin', NULL, ?, 'San Francisco', 37.7749, -122.4194, 5.0, 1, 0)
        """, ("admin@sentinel.ai", admin_pwd, "Security Officer Vance", now))

    # Null out legacy face embeddings that are not 128-d SFace descriptors
    # (e.g. vectors produced by the removed PyTorch engine). Affected users
    # re-enrol automatically on their next face-verified login.
    cursor.execute("SELECT id, face_embedding FROM users WHERE face_embedding IS NOT NULL")
    for row in cursor.fetchall():
        try:
            emb = json.loads(row[1])
            valid = isinstance(emb, list) and len(emb) == 128
        except (ValueError, TypeError):
            valid = False
        if not valid:
            cursor.execute("UPDATE users SET face_embedding = NULL WHERE id = ?", (row[0],))

    # Migration: if the stored face_threshold is still the old strict default
    # (0.62), lower it to 0.55 so webcam-enrolled users can actually log in.
    # Webcam-to-webcam SFace cosine similarity is naturally lower than
    # dedicated biometric hardware; 0.55 matches the real-world distribution.
    cursor.execute("SELECT face_threshold, require_iris FROM security_policies WHERE id = 1")
    thresh_row = cursor.fetchone()
    if thresh_row:
        updates = []
        params = []
        if float(thresh_row[0]) >= 0.62:
            updates.append("face_threshold = 0.55")
        # Disable require_iris by default — webcam iris detection is unreliable
        # and was adding +25 to the risk score for legitimate users.
        if thresh_row[1] == 1:
            updates.append("require_iris = 0")
        if updates:
            updates.append("updated_at = ?")
            params.append(datetime.datetime.utcnow().isoformat())
            cursor.execute(
                f"UPDATE security_policies SET {', '.join(updates)} WHERE id = 1",
                params
            )

    # Seed Initial Rich Audit Logs for Dashboard Charts & Map
    cursor.execute("SELECT COUNT(*) FROM audit_logs")
    if cursor.fetchone()[0] == 0:
        seed_logs = [
            ("2026-09-23T08:15:22", "alex.mercer@enterprise.io", "198.51.100.24", "New York", 40.7128, -74.0060, 12.5, "LOW", "ALLOWED", 0.94, 1, 2.8, 0, 1.2, "None - Normal Verified Access"),
            ("2026-09-23T08:45:10", "admin@sentinel.ai", "192.0.2.1", "San Francisco", 37.7749, -122.4194, 8.0, "LOW", "ALLOWED", 0.98, 1, 2.1, 0, 0.4, "None - Verified Root Auth"),
            ("2026-09-23T09:20:41", "alex.mercer@enterprise.io", "198.51.100.89", "Philadelphia", 39.9526, -75.1652, 48.0, "MEDIUM", "MFA_REQUIRED", 0.89, 1, 4.1, 0, 152.0, "Geo-drift distance > allowed radius; Step-up MFA OTP challenged"),
            ("2026-09-23T01:30:15", "alex.mercer@enterprise.io", "185.220.101.5", "Frankfurt", 50.1109, 8.6821, 88.5, "HIGH", "BLOCKED", 0.22, 0, 12.4, 1, 6200.0, "Time anomaly (01:30 outside 08:00-20:00), Face mismatch (0.22), Typing duration 12.4s > threshold"),
            ("2026-09-23T03:12:00", "unknown_intruder@darknet.org", "91.240.118.172", "Bucharest", 44.4268, 26.1025, 96.0, "HIGH", "BLOCKED", 0.05, 0, 18.2, 1, 7600.0, "Brute force bot pattern, Face invalid, Keystone flight jitter extreme"),
            ("2026-09-23T10:05:44", "alex.mercer@enterprise.io", "198.51.100.24", "New York", 40.7128, -74.0060, 15.0, "LOW", "ALLOWED", 0.92, 1, 3.0, 0, 1.8, "None - Authorized Routine Login"),
            ("2026-09-23T10:22:18", "sarah.connor@cyberdyne.com", "203.0.113.195", "Tokyo", 35.6762, 139.6503, 79.0, "HIGH", "BLOCKED", 0.31, 1, 8.8, 0, 10800.0, "Cross-continental IP jump, Typing duration 8.8s exceeded 7.5s policy"),
            ("2026-09-23T10:28:50", "admin@sentinel.ai", "192.0.2.1", "San Francisco", 37.7749, -122.4194, 38.0, "MEDIUM", "MFA_REQUIRED", 0.81, 1, 6.2, 0, 0.8, "Typing speed latency spike; challenged with Ping Identity OTP")
        ]
        cursor.executemany("""
        INSERT INTO audit_logs (
            timestamp, email, ip_address, city, latitude, longitude,
            risk_score, risk_level, action_taken, face_similarity, iris_detected,
            typing_duration_sec, time_anomaly_flag, location_distance_km, failure_reasons
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, seed_logs)

    conn.commit()
    conn.close()

def get_policies() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM security_policies ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return {}

def update_policies(data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE security_policies
    SET start_hour = ?,
        end_hour = ?,
        max_typing_seconds = ?,
        min_typing_seconds = ?,
        face_threshold = ?,
        max_geo_km = ?,
        risk_low_max = ?,
        risk_med_max = ?,
        require_iris = ?,
        snapdragon_tee_mode = ?,
        updated_at = ?
    WHERE id = 1
    """, (
        int(data.get("start_hour", 8)),
        int(data.get("end_hour", 20)),
        float(data.get("max_typing_seconds", 7.5)),
        float(data.get("min_typing_seconds", 0.6)),
        float(data.get("face_threshold", 0.55)),
        float(data.get("max_geo_km", 60.0)),
        float(data.get("risk_low_max", 30.0)),
        float(data.get("risk_med_max", 70.0)),
        1 if data.get("require_iris", True) else 0,
        1 if data.get("snapdragon_tee_mode", True) else 0,
        datetime.datetime.utcnow().isoformat()
    ))
    conn.commit()
    conn.close()
    return get_policies()

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", (email,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def create_user(email: str, password: str, full_name: str, face_embedding: List[float],
                home_city: str = "Local", home_lat: float = 37.7749, home_lng: float = -122.4194,
                base_typing_speed: float = 4.0, role: str = "user", iris_verified: int = 0) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    pwd_hash = hash_password(password)
    now = datetime.datetime.utcnow().isoformat()
    emb_json = json.dumps(face_embedding) if face_embedding else None

    cursor.execute("""
    INSERT INTO users (email, password_hash, full_name, role, face_embedding, enrolled_at, home_city, home_lat, home_lng, base_typing_speed, iris_verified, is_blocked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    """, (email.lower(), pwd_hash, full_name, role, emb_json, now, home_city, home_lat, home_lng, base_typing_speed, iris_verified))
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return user_id

def update_user_face_embedding(email: str, face_embedding: Optional[List[float]]) -> None:
    """Re-enrol (or clear) the stored SFace descriptor for an existing user."""
    conn = get_connection()
    cursor = conn.cursor()
    emb_json = json.dumps(face_embedding) if face_embedding else None
    cursor.execute(
        "UPDATE users SET face_embedding = ?, enrolled_at = ? WHERE LOWER(email) = LOWER(?)",
        (emb_json, datetime.datetime.utcnow().isoformat(), email)
    )
    conn.commit()
    conn.close()

def update_user_credentials(email: str, password: str, full_name: Optional[str] = None) -> None:
    """Refresh credentials of an existing account (used when a re-registration
    is accepted because the presented face matched the enrolled template)."""
    conn = get_connection()
    cursor = conn.cursor()
    pwd_hash = hash_password(password)
    if full_name:
        cursor.execute(
            "UPDATE users SET password_hash = ?, full_name = ? WHERE LOWER(email) = LOWER(?)",
            (pwd_hash, full_name, email)
        )
    else:
        cursor.execute(
            "UPDATE users SET password_hash = ? WHERE LOWER(email) = LOWER(?)",
            (pwd_hash, email)
        )
    conn.commit()
    conn.close()

def delete_user_by_email(email: str) -> Optional[str]:
    """Remove a user plus their OTP tokens and session records.

    Returns None on success, or an error string (unknown email / protected
    admin role) explaining why nothing was deleted.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT role FROM users WHERE LOWER(email) = LOWER(?)", (email,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return "User not found in registry."
    if row[0] == "admin":
        conn.close()
        return "Administrator accounts are protected and cannot be deleted."
    cursor.execute("DELETE FROM users WHERE LOWER(email) = LOWER(?)", (email,))
    cursor.execute("DELETE FROM otp_tokens WHERE LOWER(email) = LOWER(?)", (email,))
    cursor.execute("DELETE FROM sessions WHERE LOWER(email) = LOWER(?)", (email,))
    conn.commit()
    conn.close()
    return None

def log_audit_event(email: str, ip: str, city: str, lat: float, lng: float,
                    risk_score: float, risk_level: str, action_taken: str,
                    face_similarity: float, iris_detected: bool,
                    typing_duration: float, time_anomaly: bool,
                    distance_km: float, reasons: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO audit_logs (
        timestamp, email, ip_address, city, latitude, longitude,
        risk_score, risk_level, action_taken, face_similarity, iris_detected,
        typing_duration_sec, time_anomaly_flag, location_distance_km, failure_reasons
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        datetime.datetime.utcnow().isoformat(),
        email, ip, city, lat, lng,
        risk_score, risk_level, action_taken,
        face_similarity, 1 if iris_detected else 0,
        typing_duration, 1 if time_anomaly else 0,
        distance_km, reasons
    ))
    conn.commit()
    conn.close()

def get_all_audit_logs(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_all_users() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, full_name, role, enrolled_at, home_city, home_lat, home_lng, base_typing_speed, iris_verified, is_blocked, (face_embedding IS NOT NULL) AS has_face FROM users ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_otp(email: str, otp_code: str, risk_score: float) -> str:
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.datetime.utcnow()
    expires = now + datetime.timedelta(minutes=5)
    cursor.execute("""
    INSERT INTO otp_tokens (email, otp_code, created_at, expires_at, risk_score, is_used)
    VALUES (?, ?, ?, ?, ?, 0)
    """, (email.lower(), otp_code, now.isoformat(), expires.isoformat(), risk_score))
    conn.commit()
    conn.close()
    return otp_code

def verify_otp_token(email: str, otp_code: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.datetime.utcnow().isoformat()
    cursor.execute("""
    SELECT id FROM otp_tokens
    WHERE LOWER(email) = LOWER(?) AND otp_code = ? AND expires_at > ? AND is_used = 0
    ORDER BY id DESC LIMIT 1
    """, (email, otp_code.strip(), now))
    row = cursor.fetchone()
    if row:
        token_id = row[0]
        cursor.execute("UPDATE otp_tokens SET is_used = 1 WHERE id = ?", (token_id,))
        conn.commit()
        conn.close()
        return True
    conn.close()
    return False

# Initialize on import
init_db()
