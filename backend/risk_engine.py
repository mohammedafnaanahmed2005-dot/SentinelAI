import math
import datetime
from typing import Dict, Any, List, Tuple

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Computes the great-circle distance between two GPS coordinates in kilometers.
    """
    R = 6371.0 # Earth radius in km
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0)**2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 2)

class AdaptiveRiskEngine:
    def __init__(self):
        pass

    def calculate_risk(
        self,
        user: Dict[str, Any],
        policy: Dict[str, Any],
        face_similarity: float,
        face_detected: bool,
        iris_detected: bool,
        typing_duration: float,
        keystroke_intervals: List[float],
        user_lat: float,
        user_lng: float,
        login_hour: int,
        mouse_events_count: int
    ) -> Dict[str, Any]:
        """
        Evaluates multi-vector risk and returns composite risk score, risk level,
        sub-scores, and policy breach explanations.
        """
        reasons = []
        is_hard_blocked = False

        # 1. Biometric Risk (Face & Iris) - Weight: 35%
        face_subscore = 0.0
        face_threshold = float(policy.get("face_threshold", 0.55))
        
        if not face_detected:
            face_subscore = 100.0
            reasons.append("Biometric failure: No authorized human face detected")
            # Face-first authentication: without a live face there is nothing to
            # compare against the registered photo -> immediate hard block.
            is_hard_blocked = True
            reasons.append("BLOCKED: Face detection failed - registered photo could not be verified")
        elif face_similarity < face_threshold:
            # Scale distance from threshold
            gap = (face_threshold - face_similarity) / face_threshold
            face_subscore = min(100.0, 50.0 + gap * 50.0)
            reasons.append(f"Facial mismatch: Similarity {face_similarity:.2f} < threshold {face_threshold:.2f}")
            # Registered photo does NOT match the current user in front of the
            # camera -> identity spoofing. Hard block immediately; never allow
            # this attempt to degrade to MFA (OTP would bypass the biometric).
            is_hard_blocked = True
            reasons.append("BLOCKED: Registered photo does not match the current face - identity rejected")
        else:
            # Safe similarity
            face_subscore = max(0.0, (1.0 - face_similarity) * 20.0)

        # Iris check — only penalise if face was NOT matched (iris is a
        # supplementary signal, not a hard gate on its own). When the face
        # similarity already passed the threshold, skip the iris penalty so
        # webcam iris detection noise doesn't incorrectly elevate risk.
        if policy.get("require_iris", True) and not iris_detected and face_similarity < face_threshold:
            face_subscore = min(100.0, face_subscore + 25.0)
            reasons.append("Iris tracking unverified or liveness challenge failed")

        # 2. Keystroke Dynamics & Typing Speed - Weight: 25%
        typing_subscore = 0.0
        max_typing_sec = float(policy.get("max_typing_seconds", 7.5))
        min_typing_sec = float(policy.get("min_typing_seconds", 0.6))

        if typing_duration > max_typing_sec:
            overtime = typing_duration - max_typing_sec
            typing_subscore = min(100.0, 55.0 + overtime * 15.0)
            reasons.append(f"Unauthorized typing speed: Duration {typing_duration:.1f}s exceeded policy limit ({max_typing_sec:.1f}s)")
            if typing_duration > max_typing_sec * 1.6:
                is_hard_blocked = True
                reasons.append("Suspicious protracted keystroke pattern flagged as intruder credential testing")
        elif typing_duration < min_typing_sec:
            # Bot / automated macro typing
            typing_subscore = 90.0
            reasons.append(f"Synthetic typing anomaly: Sub-human typing duration ({typing_duration:.2f}s) indicates automated bot injection")
        else:
            # Evaluate interval cadence jitter
            if keystroke_intervals and len(keystroke_intervals) > 2:
                avg_interval = sum(keystroke_intervals) / len(keystroke_intervals)
                variance = sum((x - avg_interval)**2 for x in keystroke_intervals) / len(keystroke_intervals)
                std_dev = math.sqrt(variance)
                # Extremely unnatural cadence or extremely erratic cadence
                if std_dev < 5.0: # Machine constant 0ms latency between keys
                    typing_subscore = 80.0
                    reasons.append("Zero variance keypress rhythm detected (automated tool)")
                else:
                    typing_subscore = min(20.0, std_dev / 50.0)
            else:
                typing_subscore = 10.0

        # 3. Geo-Location Algorithm - Weight: 20%
        geo_subscore = 0.0
        home_lat = float(user.get("home_lat", 37.7749))
        home_lng = float(user.get("home_lng", -122.4194))
        max_geo_km = float(policy.get("max_geo_km", 60.0))
        
        distance_km = haversine_distance(home_lat, home_lng, user_lat, user_lng)
        
        if distance_km > max_geo_km:
            drift = distance_km - max_geo_km
            if distance_km > 1000.0:
                geo_subscore = min(100.0, 75.0 + (distance_km / 1000.0) * 5.0)
                reasons.append(f"Geo-location breach: Cross-region attempt {distance_km:.1f} km away from registered baseline")
            else:
                geo_subscore = min(70.0, 35.0 + (drift / 50.0) * 10.0)
                reasons.append(f"Location deviation: {distance_km:.1f} km exceeds permitted radius ({max_geo_km:.1f} km)")
        else:
            geo_subscore = max(0.0, (distance_km / max_geo_km) * 10.0)

        # 4. Temporal Schedule Algorithm - Weight: 15%
        time_subscore = 0.0
        start_hour = int(policy.get("start_hour", 8))
        end_hour = int(policy.get("end_hour", 20))
        time_anomaly = False

        if start_hour <= end_hour:
            is_in_window = (start_hour <= login_hour <= end_hour)
        else: # Overnight shift
            is_in_window = (login_hour >= start_hour or login_hour <= end_hour)

        if not is_in_window:
            time_anomaly = True
            time_subscore = 80.0
            reasons.append(f"Temporal anomaly: Login attempt at {login_hour:02d}:00 is outside admin policy hours ({start_hour:02d}:00 - {end_hour:02d}:00)")
        else:
            time_subscore = 5.0

        # 5. Mouse Behavior & Interaction Entropy - Weight: 5%
        mouse_subscore = 0.0
        if mouse_events_count < 3:
            mouse_subscore = 65.0
            reasons.append("Zero/minimal pointer entropy detected prior to authentication")
        else:
            mouse_subscore = 5.0

        # 6. Compound Threat Aggregation:
        # A face mismatch alone is already a hard block (see section 1). If it is
        # combined with a location/time anomaly the threat is even more severe.
        if face_similarity < face_threshold and (distance_km > max_geo_km or time_anomaly):
            is_hard_blocked = True
            reasons.append("CRITICAL: Combined Face Mismatch with Spatial/Temporal Anomaly detected & blocked!")

        # Weighted Sum
        composite_score = (
            face_subscore * 0.35 +
            typing_subscore * 0.25 +
            geo_subscore * 0.20 +
            time_subscore * 0.15 +
            mouse_subscore * 0.05
        )

        if is_hard_blocked:
            composite_score = max(composite_score, 85.0)

        composite_score = round(min(100.0, max(0.0, composite_score)), 1)

        # Thresholds
        risk_low_max = float(policy.get("risk_low_max", 30.0))
        risk_med_max = float(policy.get("risk_med_max", 70.0))

        if composite_score <= risk_low_max and not is_hard_blocked:
            risk_level = "LOW"
            action_taken = "ALLOWED"
            status_message = "Authentication Verified: Low Threat Assessment"
        elif composite_score <= risk_med_max and not is_hard_blocked:
            risk_level = "MEDIUM"
            action_taken = "MFA_REQUIRED"
            status_message = "Medium Risk Detected: Step-Up OTP Verification Required"
        else:
            risk_level = "HIGH"
            action_taken = "BLOCKED"
            status_message = "Access Denied: High Security Risk Detected - Session Terminated"

        return {
            "risk_score": composite_score,
            "risk_level": risk_level,
            "action_taken": action_taken,
            "status_message": status_message,
            "distance_km": distance_km,
            "time_anomaly": time_anomaly,
            "reasons": reasons if reasons else ["Baseline parameters within normal tolerance"],
            "subscores": {
                "face_biometric": round(face_subscore, 1),
                "typing_dynamics": round(typing_subscore, 1),
                "geo_location": round(geo_subscore, 1),
                "temporal_schedule": round(time_subscore, 1),
                "mouse_entropy": round(mouse_subscore, 1)
            }
        }

risk_engine = AdaptiveRiskEngine()
