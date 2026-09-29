// ============================================================
//  SentinelAI – TypeScript Type Definitions
// ============================================================

export interface VisionFrameResponse {
  face_detected: boolean;
  face_bbox: [number, number, number, number] | null;
  iris_detected: boolean;
  iris_points: IrisPoint[];
  liveness_score: number;
  message: string;
  /** True when the camera delivered an all-black frame (shutter/cover/busy). */
  frame_black?: boolean;
  error?: string;
}

export interface IrisPoint {
  x: number;
  y: number;
  radius: number;
  eye_box: [number, number, number, number];
}

export interface LoginRequest {
  email: string;
  password: string;
  image_base64: string | null;
  typing_duration_sec: number;
  keystroke_intervals: number[];
  latitude: number;
  longitude: number;
  city: string;
  login_hour: number;
  mouse_events_count: number;
}

export interface LoginResponse {
  status: 'SUCCESS' | 'MFA_REQUIRED' | 'BLOCKED';
  action: 'ALLOWED' | 'MFA_REQUIRED' | 'BLOCKED' | 'ALLOWED_AFTER_MFA';
  message: string;
  risk_score: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  subscores: RiskSubscores;
  reasons?: string[];
  /** Legacy FastAPI error field - only present on unhandled rejections. */
  detail?: string;
  /** Set on BLOCKED responses for unidentified subjects: raise a dead-end OTP
   *  prompt after the failed verification. No code is ever issued. */
  otp_challenge?: boolean;
  /** When true, a real OTP was issued (face detected but mismatched for a
   *  registered user). The challenge routes to verify-blocked-otp and CAN
   *  succeed. When false/absent the challenge is a dead-end. */
  otp_recoverable?: boolean;
  /** Message to display in the OTP modal when otp_challenge is true. */
  otp_message?: string;
  session_token?: string;
  session_id?: number;
  login_time?: string;
  user?: {
    email: string;
    full_name: string;
    role: string;
    home_city: string;
  };
}

export interface RiskSubscores {
  face_biometric: number;
  typing_dynamics: number;
  geo_location: number;
  temporal_schedule: number;
  mouse_entropy: number;
}

export interface SecurityPolicy {
  id: number;
  start_hour: number;
  end_hour: number;
  max_typing_seconds: number;
  min_typing_seconds: number;
  face_threshold: number;
  max_geo_km: number;
  risk_low_max: number;
  risk_med_max: number;
  require_iris: number;
  snapdragon_tee_mode: number;
  updated_at: string;
}

export interface DashboardStats {
  total_attempts: number;
  blocked_attacks: number;
  mfa_challenges: number;
  allowed_logins: number;
  avg_risk_score: number;
  risk_breakdown: Record<string, number>;
  geo_points: GeoPoint[];
}

export interface GeoPoint {
  id: number;
  timestamp: string;
  email: string;
  city: string;
  latitude: number;
  longitude: number;
  risk_score: number;
  risk_level: string;
  action_taken: string;
  failure_reasons: string;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  email: string;
  ip_address: string;
  city: string;
  latitude: number;
  longitude: number;
  risk_score: number;
  risk_level: string;
  action_taken: string;
  face_similarity: number;
  iris_detected: number;
  typing_duration_sec: number;
  time_anomaly_flag: number;
  location_distance_km: number;
  failure_reasons: string;
}

export interface UserRecord {
  id: number;
  email: string;
  full_name: string;
  role: string;
  enrolled_at: string;
  home_city: string;
  home_lat: number;
  home_lng: number;
  base_typing_speed: number;
  iris_verified: number;
  is_blocked: number;
  has_face: number;
}

export interface GeoLocation {
  lat: number;
  lng: number;
  city: string;
}

export interface BehavioralPayload {
  typing_duration_sec: number;
  keystroke_intervals: number[];
  latitude: number;
  longitude: number;
  city: string;
  login_hour: number;
  mouse_events_count: number;
}

/** A row from the login/logout session register. */
export interface SessionRecord {
  id: number;
  session_token: string;
  user_name: string | null;
  email: string;
  role: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  login_time: string;
  logout_time: string | null;
  face_similarity: number;
  face_verified: number;
  risk_score: number;
  status: 'ACTIVE' | 'CLOSED';
}
