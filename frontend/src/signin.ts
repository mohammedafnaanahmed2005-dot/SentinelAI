// ============================================================
//  SentinelAI – Sign-In Page Entry Point
//  Facial verification + email/password + keystroke dynamics +
//  location. On success stores the session and redirects to the
//  shared dashboard page.
// ============================================================

import './style.css';
import { VisionHUDController }    from './visionHUD.ts';
import { BehavioralSensorEngine } from './behavioralSensor.ts';
import { saveSession, getSession } from './session.ts';
import type { LoginResponse }     from './types.ts';

const vision  = new VisionHUDController();
const sensors = new BehavioralSensorEngine();

let pendingEmail = '';
let signInLabel = 'VERIFY FACE & SIGN IN';
// True when the OTP modal was opened after a BLOCKED response.
// If otp_recoverable is also true, a real OTP was issued and verify-blocked-otp
// can succeed. Otherwise it is a dead-end challenge.
let otpChallengeMode = false;
let otpRecoverable = false;

(window as any).sentinel = { vision, sensors };

document.addEventListener('DOMContentLoaded', async () => {
  if (getSession()?.token) { window.location.replace('/dashboard.html'); return; }
  await vision.initCamera();
  document.getElementById('authEmail')?.addEventListener('change', () => { void refreshSignInLabel(); });
});

/* ─── Role-aware button label ─────────────────────── */
async function refreshSignInLabel(): Promise<void> {
  const email = (document.getElementById('authEmail') as HTMLInputElement)?.value.trim();
  const label = document.getElementById('btnAuthLabel');
  if (!email || !label) return;
  try {
    const r = await fetch(`/api/auth/face-policy?email=${encodeURIComponent(email)}`);
    const p = await r.json();
    signInLabel = p.face_required === false ? 'SIGN IN (ADMIN — PASSWORD ONLY)' : 'VERIFY FACE & SIGN IN';
    if (label.innerText !== 'ANALYSING BIOMETRICS...') label.innerText = signInLabel;
  } catch { /* keep default label */ }
}

/* ─── Toast ─────────────────────────────────────────────── */
function toast(msg: string, type: 'success' | 'warning' | 'error' = 'success'): void {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const colors: Record<string, string> = { success: 'text-cyan-400', warning: 'text-amber-400', error: 'text-red-400' };
  const t = document.createElement('div');
  t.className = 'toast';
  const span = document.createElement('span');
  span.className = `font-bold ${colors[type]}`;
  span.textContent = '⚡';
  const text = document.createElement('span');
  text.textContent = msg;
  t.append(span, text);
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

/* ─── Assessment card ───────────────────────────────────── */
function showAssessment(
  action: string, score: number, level: string,
  reasons: string[], subscores: Record<string, number>
): void {
  const card = document.getElementById('assessmentCard');
  if (!card) return;
  card.classList.remove('hidden');

  const palette: Record<string, { bg: string; border: string; text: string }> = {
    ALLOWED:           { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400' },
    ALLOWED_AFTER_MFA: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400' },
    MFA_REQUIRED:      { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-400'   },
    BLOCKED:           { bg: 'bg-red-500/10',     border: 'border-red-500/30',     text: 'text-red-400'     }
  };
  const p = palette[action] ?? palette.BLOCKED;
  const icon = action.startsWith('ALLOWED') ? '✅' : action === 'MFA_REQUIRED' ? '⚠️' : '🚫';

  const subHTML = Object.entries(subscores).map(([k, v]) => `
    <div class="text-center">
      <div class="font-mono text-[9px] text-slate-500 uppercase mb-0.5">${k.replace('_', ' ')}</div>
      <div class="font-mono text-xs font-bold ${v > 60 ? 'text-red-400' : v > 30 ? 'text-amber-400' : 'text-emerald-400'}">${v}%</div>
    </div>`).join('');

  const reasonsHTML = reasons.length
    ? `<ul class="mt-2 text-[11px] text-slate-400 space-y-0.5">${reasons.map(r => `<li class="flex items-start gap-1.5"><span class="mt-0.5 shrink-0">›</span>${String(r).replace(/</g, '&lt;')}</li>`).join('')}</ul>`
    : '';

  card.className = `rounded-xl p-4 border mt-4 ${p.bg} ${p.border}`;
  card.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <div class="${p.text} font-display text-sm font-black tracking-wide flex items-center gap-2">${icon} ${action.replace('_', ' ')}</div>
      <div class="font-mono text-lg font-black text-white">${score.toFixed(1)}<span class="text-xs text-slate-400">%</span></div>
    </div>
    <div class="w-full h-1.5 bg-white/8 rounded-full overflow-hidden mb-3">
      <div class="h-full rounded-full ${score > 70 ? 'bg-red-500' : score > 30 ? 'bg-amber-400' : 'bg-emerald-400'}" style="width:${score}%"></div>
    </div>
    ${Object.keys(subscores).length ? `<div class="grid grid-cols-5 gap-2 border-t border-white/8 pt-3 mb-2">${subHTML}</div>` : ''}
    ${reasonsHTML}`;
  void level;
}

/* ─── Session persistence + redirect ────────────────────── */
function completeLogin(data: any): void {
  saveSession({
    token: data.session_token,
    session_id: data.session_id,
    login_time: data.login_time ?? new Date().toISOString(),
    user: {
      email: data.user?.email ?? pendingEmail,
      full_name: data.user?.full_name ?? 'Verified User',
      role: data.user?.role ?? 'user',
      home_city: data.user?.home_city
    }
  });
  toast(`✅ Welcome ${data.user?.full_name ?? ''}! Access granted.`);
  setTimeout(() => { window.location.href = '/dashboard.html'; }, 700);
}

/* ─── Sign In ───────────────────────────────────────────── */
(window as any).handleSignIn = async (): Promise<void> => {
  const email = (document.getElementById('authEmail') as HTMLInputElement).value.trim();
  const pwd   = (document.getElementById('authPassword') as HTMLInputElement).value;
  const label = document.getElementById('btnAuthLabel');

  if (!email || !pwd) { showAssessment('BLOCKED', 0, 'HIGH', ['Please enter both email and password.'], {}); return; }

  // Role-based policy: admins sign in with email + password only - facial
  // recognition is never requested for them. Everyone else must present a
  // live face before credentials are transmitted.
  let faceRequired = true;
  try {
    const polRes = await fetch(`/api/auth/face-policy?email=${encodeURIComponent(email)}`);
    const pol = await polRes.json();
    faceRequired = pol.face_required !== false;
  } catch { faceRequired = true; }

  // Face-first gate: check facial detection BEFORE anything else. Without a
  // live face in front of the camera the attempt is blocked immediately -
  // credentials are never even transmitted. A cached backend-confirmed face
  // frame also satisfies the gate (the live poll can momentarily lose a face).
  if (faceRequired && !vision.currentVision.face_detected && !vision.hasGoodSnapshot() && !vision.isSimulated) {
    // The 450ms poll state can be stale (e.g. right after a backend restart).
    // Do one fresh backend-confirmed analysis of the current frame before
    // giving up, so a genuine face is not rejected on click.
    await vision.analyzeOnce();
  }
  if (faceRequired && !vision.currentVision.face_detected && !vision.hasGoodSnapshot() && !vision.isSimulated) {
    const camLine = vision.cameraUnavailable
      ? `CAMERA UNAVAILABLE: ${vision.cameraErrorReason}`
      : 'Face detection FAILED: no live face in front of the camera.';
    showAssessment('BLOCKED', 95, 'HIGH', [
      camLine,
      'BLOCKED: facial verification is mandatory - sign-in rejected before credential check.'
    ], { face_biometric: 100 });
    toast(vision.cameraUnavailable ? '🚫 Camera unavailable — see message.' : '🚫 No face detected — sign-in blocked.', 'error');
    return;
  }

  pendingEmail = email;
  if (label) label.innerText = 'ANALYSING BIOMETRICS...';

  // Submit the last frame the backend CONFIRMED contains a face - a random
  // click-time frame can be blurred/mid-motion and would fail the match.
  const snap   = vision.getBestSnapshot(640, 480);
  const sensor = sensors.getPayload();
  await sensors.acquireLocation();

  const body = {
    email, password: pwd,
    image_base64:        snap,
    typing_duration_sec: sensor.typing_duration_sec,
    keystroke_intervals: sensor.keystroke_intervals,
    latitude:            sensors.location.lat,
    longitude:           sensors.location.lng,
    city:                sensors.location.city,
    login_hour:          sensor.login_hour,
    mouse_events_count:  sensor.mouse_events_count
  };

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = (await res.json()) as LoginResponse;

    // Non-2xx responses (401/403) now carry a structured BLOCKED payload:
    // unregistered email, wrong password or locked account. Render it as a
    // proper security assessment instead of a generic network error.
    if (!res.ok) {
      const reasons = data.reasons?.length
        ? data.reasons
        : [String((data as any).detail ?? 'Authentication rejected by security policy.')];
      showAssessment(data.action ?? 'BLOCKED', data.risk_score ?? 99, data.risk_level ?? 'HIGH',
        reasons, (data.subscores ?? {}) as unknown as Record<string, number>);
      toast(`🚫 ${reasons.find(r => r.startsWith('BLOCKED')) ?? 'Access blocked.'}`, 'error');
      // Unidentified subject: after the failed verification, raise the OTP
      // prompt. No code was ever sent, so this challenge can never succeed.
      if (data.otp_challenge) openOtpModal(data.otp_message ?? '', true, !!data.otp_recoverable);
      return;
    }

    showAssessment(data.action, data.risk_score ?? 0, data.risk_level ?? 'HIGH', data.reasons ?? [], (data.subscores ?? {}) as unknown as Record<string, number>);

    if (data.action === 'ALLOWED') {
      completeLogin(data);
    } else if (data.action === 'MFA_REQUIRED') {
      openOtpModal(data.message ?? '');
    }
  } catch {
    showAssessment('BLOCKED', 99, 'HIGH', ['Network error – backend unreachable.'], {});
  } finally {
    if (label) label.innerText = signInLabel;
  }
};

/* ─── OTP Modal ─────────────────────────────────────────── */
function openOtpModal(message: string, challengeMode = false, recoverable = false): void {
  const modal = document.getElementById('otpModal');
  if (!modal) return;
  otpChallengeMode = challengeMode;
  otpRecoverable = recoverable;
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Update modal title/badge to reflect whether this is a recoverable
  // face-mismatch OTP or a dead-end challenge.
  const badge = modal.querySelector<HTMLElement>('.otp-badge');
  if (badge) {
    badge.innerText = recoverable ? 'FACE MISMATCH — STEP-UP OTP' : 'SECURITY CHALLENGE';
    badge.className = `otp-badge font-mono text-[10px] px-2 py-1 rounded border ${
      recoverable
        ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
        : 'bg-red-500/10 border-red-500/20 text-red-400'
    }`;
  }

  const info = document.getElementById('otpChannelInfo');
  if (info) {
    info.innerText = message || (recoverable
      ? 'A 6-digit OTP has been sent to your registered secure channel. The code is never displayed on screen.'
      : 'Identity verification failed. This is a security challenge. The code cannot be retrieved.');
  }

  document.querySelectorAll<HTMLInputElement>('.otp-digit').forEach((inp, idx, arr) => {
    inp.value = '';
    inp.addEventListener('input', () => { if (inp.value && idx < arr.length - 1) arr[idx + 1].focus(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && idx > 0) arr[idx - 1].focus(); });
  });
  (document.getElementById('otp1') as HTMLInputElement)?.focus();
}

(window as any).verifyOtp = async (): Promise<void> => {
  const code = [1, 2, 3, 4, 5, 6]
    .map(i => (document.getElementById(`otp${i}`) as HTMLInputElement)?.value ?? '')
    .join('');
  if (code.length !== 6) { toast('Please enter all 6 OTP digits', 'warning'); return; }

  // Regular MFA (medium-risk) uses /api/auth/verify-otp.
  // Post-block challenge (face mismatch or unidentified) uses /api/auth/verify-blocked-otp.
  // The blocked endpoint now actually verifies codes for recoverable face-mismatch cases.
  const endpoint = otpChallengeMode ? '/api/auth/verify-blocked-otp' : '/api/auth/verify-otp';
  const res  = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: pendingEmail, otp_code: code })
  });
  const data = await res.json();
  const modal = document.getElementById('otpModal');
  modal?.classList.add('hidden');
  modal?.classList.remove('flex');

  if (data.status === 'SUCCESS' && (data.action === 'ALLOWED_AFTER_MFA' || data.action === 'ALLOWED')) {
    const riskScore = otpChallengeMode && otpRecoverable ? 28 : 0;
    showAssessment('ALLOWED_AFTER_MFA', riskScore, 'LOW',
      [otpChallengeMode && otpRecoverable
        ? 'Face mismatch step-up OTP verified. Access granted after MFA.'
        : 'MFA OTP verified. Access granted.'],
      {});
    completeLogin(data);
  } else {
    const reasons = data.reasons?.length
      ? data.reasons
      : ['OTP verification failed – access remains blocked.'];
    showAssessment('BLOCKED', data.risk_score ?? 85, 'HIGH', reasons,
      (data.subscores ?? {}) as unknown as Record<string, number>);
    toast('❌ Invalid OTP. Access remains blocked.', 'error');
  }
  otpChallengeMode = false;
  otpRecoverable = false;
};

/* ─── Demo Quick-Fill ───────────────────────────────────── */
(window as any).demoFill = (scenario: string): void => {
  const emailEl = document.getElementById('authEmail')    as HTMLInputElement;
  const pwdEl   = document.getElementById('authPassword') as HTMLInputElement;

  const SCENARIOS: Record<string, { email: string; pwd: string; city: string; lat: number; lng: number; typing: number }> = {
    admin:       { email: 'admin@sentinel.ai',         pwd: 'Admin@Cyber2026!', city: 'San Francisco, CA', lat: 37.7749, lng: -122.4194, typing: 2.1 },
    normal:      { email: 'demo.unregistered@fake.io', pwd: 'Whatever#2026',    city: 'New York, NY',      lat: 40.7128, lng: -74.006,   typing: 2.8 },
    geo_anomaly: { email: 'demo.unregistered@fake.io', pwd: 'Whatever#2026',    city: 'Frankfurt, DE',     lat: 50.1109, lng: 8.6821,    typing: 4.5 },
    intruder:    { email: 'demo.unregistered@fake.io', pwd: 'Whatever#2026',    city: 'Bucharest, RO',     lat: 44.4268, lng: 26.1025,   typing: 13.2 }
  };
  const s = SCENARIOS[scenario];
  if (!s) return;

  if (emailEl) emailEl.value = s.email;
  if (pwdEl)   pwdEl.value   = s.pwd;
  sensors.simulateLocation(s.city, s.lat, s.lng);
  sensors.simulateTyping(s.typing);

  const labels: Record<string, string> = {
    admin:       '✅ Admin scenario — expect LOW RISK',
    normal:      '🚫 Unregistered email demo — expect BLOCKED',
    geo_anomaly: '🚫 Unregistered email (foreign geo) — expect BLOCKED',
    intruder:    '🚫 Unregistered intruder simulation — expect BLOCKED'
  };
  toast(labels[scenario] ?? 'Demo loaded');
};
