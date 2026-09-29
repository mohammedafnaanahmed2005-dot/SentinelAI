// ============================================================
//  SentinelAI – Admin Registration Page Entry Point
//  Admin-only. Enrol a new user with details, a HERE-geocoded
//  home location (geo-fence baseline) and an uploaded/captured
//  face photo.
// ============================================================

import './style.css';
import { VisionHUDController }    from './visionHUD.ts';
import { BehavioralSensorEngine } from './behavioralSensor.ts';
import { hereGeocode }            from './geoService.ts';
import { requireAdmin, logout }   from './session.ts';

const vision  = new VisionHUDController();
const sensors = new BehavioralSensorEngine();

let regPhotoDataUrl: string | null = null;
let regCoords: { lat: number; lng: number } | null = null;

(window as any).sentinel = { vision, sensors };

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAdmin()) return; // not an admin -> redirected away
  await vision.initCamera();
});

/* ─── Toast ─────────────────────────────────────────────── */
function toast(msg: string, type: 'success' | 'warning' | 'error' = 'success'): void {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const colors: Record<string, string> = { success: 'text-cyan-400', warning: 'text-amber-400', error: 'text-red-400' };
  const t = document.createElement('div');
  t.className = 'toast';
  const icon = document.createElement('span');
  icon.className = `font-bold ${colors[type]}`;
  icon.textContent = '⚡';
  const text = document.createElement('span');
  text.textContent = msg;
  t.append(icon, text);
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3800);
}

/* ─── Photo helpers ─────────────────────────────────────── */
function setRegPhoto(dataUrl: string | null): void {
  regPhotoDataUrl = dataUrl;
  const img = document.getElementById('regPhotoPreview') as HTMLImageElement | null;
  const ph  = document.getElementById('regPhotoPlaceholder');
  if (img) { img.src = dataUrl ?? ''; img.classList.toggle('hidden', !dataUrl); }
  ph?.classList.toggle('hidden', !!dataUrl);
}

function setRegCoords(lat: number, lng: number): void {
  regCoords = { lat, lng };
  const el = document.getElementById('regCoords') as HTMLInputElement | null;
  if (el) el.value = `${lat}, ${lng}`;
}

(window as any).onRegPhotoSelected = (ev: Event): void => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setRegPhoto(String(reader.result));
  reader.readAsDataURL(file);
};

(window as any).captureRegPhoto = async (): Promise<void> => {
  // Always try to get a backend-confirmed best snapshot first.
  // If no confirmed face snapshot exists yet, do a one-shot backend analysis
  // of the current frame to confirm the face before capturing.
  let snap: string | null = null;

  if (vision.hasGoodSnapshot()) {
    // Use the highest-liveness backend-confirmed frame already cached.
    snap = vision.getBestSnapshot(640, 480);
  } else {
    // No confirmed snapshot yet — run a single backend confirmation now
    // so the enrolled embedding is from a properly detected face.
    toast('Analysing frame…', 'warning');
    const confirmed = await vision.analyzeOnce();
    if (confirmed && vision.hasGoodSnapshot()) {
      snap = vision.getBestSnapshot(640, 480);
    } else {
      // Still no confirmed face — fall back to a live high-res capture
      // (user may then see "no face detected" at enrolment time).
      snap = vision.captureSnapshot(640, 480);
    }
  }

  if (!snap) { toast('Webcam not ready — cannot capture photo.', 'warning'); return; }
  setRegPhoto(snap);
  toast('📸 Webcam photo captured for enrolment.');
};

(window as any).geocodeRegCity = async (): Promise<void> => {
  const city = (document.getElementById('regCity') as HTMLInputElement)?.value.trim();
  if (!city) { toast('Enter a home city/address first.', 'warning'); return; }
  const geo = await hereGeocode(city);
  if (geo) { setRegCoords(geo.lat, geo.lng); toast(`🗺 Resolved "${city}" → ${geo.lat}, ${geo.lng}`); }
  else { toast('Could not geocode that location (check the HERE API key).', 'error'); }
};

(window as any).useMyLocationForReg = async (): Promise<void> => {
  const resolved = await sensors.acquireLocation();
  setRegCoords(resolved.lat, resolved.lng);
  const cityEl = document.getElementById('regCity') as HTMLInputElement | null;
  if (cityEl && !cityEl.value.trim()) cityEl.value = resolved.city;
  toast(`📍 Using detected location: ${resolved.city}`);
};

/* ─── Register ──────────────────────────────────────────── */
(window as any).handleRegister = async (): Promise<void> => {
  const email = (document.getElementById('regEmail')    as HTMLInputElement).value.trim();
  const name  = (document.getElementById('regName')     as HTMLInputElement).value.trim();
  const pwd   = (document.getElementById('regPassword') as HTMLInputElement).value;
  const city  = (document.getElementById('regCity')     as HTMLInputElement).value.trim() || 'San Francisco';
  const role  = (document.getElementById('regRole')     as HTMLSelectElement).value;
  const btn   = document.getElementById('btnRegister') as HTMLButtonElement | null;

  if (!email || !name || !pwd) { toast('Please fill all required fields.', 'warning'); return; }

  if (btn) btn.innerText = 'ENROLLING...';

  // Resolve home location: explicit geocode > geocode typed city > live location.
  const sens = sensors.getPayload();
  let homeLat = regCoords?.lat ?? sens.latitude;
  let homeLng = regCoords?.lng ?? sens.longitude;
  if (!regCoords) {
    const geo = await hereGeocode(city);
    if (geo) { homeLat = geo.lat; homeLng = geo.lng; setRegCoords(geo.lat, geo.lng); }
  }

  const snap = regPhotoDataUrl ?? vision.getBestSnapshot(640, 480) ?? vision.captureSnapshot(640, 480);
  if (!snap) { toast('No face photo available — capture a webcam photo or upload an image.', 'error'); if (btn) btn.innerText = '📋 REGISTER & ENROLL FACIAL BIOMETRIC'; return; }

  try {
    const res  = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, password: pwd, full_name: name, image_base64: snap,
        home_city: city, home_lat: homeLat, home_lng: homeLng,
        base_typing_speed: 4.0, role
      })
    });
    const data = await res.json();
    showResult(data);
    if (data.success) {
      toast(data.face_detected === false
        ? '⚠ User created but NO face detected in the photo.'
        : '✓ User enrolled with facial biometric.');
      if (data.face_detected !== false) resetForm();
    } else {
      toast(data.detail ?? 'Registration failed', 'error');
    }
  } catch {
    toast('Network error - backend unreachable.', 'error');
  } finally {
    if (btn) btn.innerText = '📋 REGISTER & ENROLL FACIAL BIOMETRIC';
  }
};

function showResult(data: any): void {
  const card = document.getElementById('regResult');
  if (!card) return;
  card.classList.remove('hidden');
  const ok = !!data.success && data.face_detected !== false;
  const warn = !!data.success && data.face_detected === false;
  card.className = `mt-4 rounded-xl p-4 border ${ok ? 'bg-emerald-500/10 border-emerald-500/30' : warn ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30'}`;
  const msg = data.message ?? data.detail ?? 'Done';
  card.innerHTML = `<div class="font-mono text-xs ${ok ? 'text-emerald-300' : warn ? 'text-amber-300' : 'text-red-300'}">${String(msg).replace(/</g, '&lt;')}</div>`;
}

function resetForm(): void {
  ['regEmail', 'regName', 'regPassword', 'regCity', 'regCoords'].forEach(id => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = '';
  });
  const file = document.getElementById('regPhoto') as HTMLInputElement | null;
  if (file) file.value = '';
  setRegPhoto(null);
  regCoords = null;
}

/* ─── Nav ───────────────────────────────────────────────── */
(window as any).goDashboard = (): void => { window.location.href = '/dashboard.html'; };
(window as any).doLogout    = async (): Promise<void> => { await logout(true); };
