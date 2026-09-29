// ============================================================
//  SentinelAI – Behavioral Sensor Engine (TypeScript)
//  Keystroke dynamics, geo-location, mouse entropy tracking.
// ============================================================

import type { BehavioralPayload, GeoLocation } from './types.ts';
import { resolveCurrentLocation, type ResolvedLocation } from './geoService.ts';

export class BehavioralSensorEngine {
  private keyTimestamps:    number[] = [];
  public  keyIntervals:     number[] = [];
  private typingStart:      number | null = null;
  public  typingDurationSec = 0;
  private mouseCount        = 0;
  private lastMouse         = { x: 0, y: 0 };
  public  adminMaxTyping    = 7.5;

  public location: GeoLocation = {
    lat:  37.7749,
    lng: -122.4194,
    city: 'Detecting location...'
  };

  /** How the current coordinates were obtained (gps / ip / fallback). */
  public locationSource: ResolvedLocation['source'] = 'fallback';

  private timerHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.bindMouseListener();
    this.acquireLocation();
    this.bindPasswordField();
    this.tickClock();
  }

  /* ─── Location Detection (GPS -> HERE reverse geocode -> IP) ── */
  async acquireLocation(): Promise<ResolvedLocation> {
    const resolved = await resolveCurrentLocation();
    // Do not clobber a location injected by a demo simulation.
    if (!this.locationLocked) {
      this.location = { lat: resolved.lat, lng: resolved.lng, city: resolved.city };
      this.locationSource = resolved.source;
    }
    this.updateGeoDOM();
    return resolved;
  }

  /** When true, demo simulations win over live GPS refreshes. */
  private locationLocked = false;

  /* ─── Mouse Entropy ─────────────────────────────────────── */
  private bindMouseListener(): void {
    window.addEventListener('mousemove', (e) => {
      this.mouseCount++;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });
  }

  /* ─── Clock ──────────────────────────────────────────────── */
  private tickClock(): void {
    const update = (): void => {
      const el = document.getElementById('sensorTime');
      const chip = document.getElementById('currentTimeChip');
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (el)   el.innerText = now;
      if (chip) chip.innerText = now;
    };
    update();
    setInterval(update, 1000);
  }

  /* ─── Password Keystroke ─────────────────────────────────── */
  private bindPasswordField(): void {
    const pwd = document.getElementById('authPassword') as HTMLInputElement | null;
    if (!pwd) return;
    pwd.addEventListener('focus', () => this.resetDynamics());
    pwd.addEventListener('keydown', (e) => this.onKey(e));
  }

  private resetDynamics(): void {
    this.keyTimestamps    = [];
    this.keyIntervals     = [];
    this.typingStart      = null;
    this.typingDurationSec = 0;
    this.updateHUDBar(0, 0);
  }

  private onKey(e: KeyboardEvent): void {
    if (['Shift','Control','Alt','Meta','Tab'].includes(e.key)) return;
    const now = performance.now();
    if (this.typingStart === null) {
      this.typingStart = now;
      this.startTimer();
    } else {
      const last = this.keyTimestamps.at(-1)!;
      this.keyIntervals.push(now - last);
    }
    this.keyTimestamps.push(now);
    const el = document.getElementById('authPassword') as HTMLInputElement;
    const elapsed = (now - this.typingStart!) / 1000;
    const cps = elapsed > 0 ? (el.value.length + 1) / elapsed : 0;
    this.updateHUDBar(elapsed, cps);
  }

  private startTimer(): void {
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.timerHandle = setInterval(() => {
      if (this.typingStart === null) return;
      const el = document.getElementById('authPassword') as HTMLInputElement;
      this.typingDurationSec = (performance.now() - this.typingStart) / 1000;
      const cps = this.typingDurationSec > 0
        ? el.value.length / this.typingDurationSec
        : 0;
      this.updateHUDBar(this.typingDurationSec, cps);
    }, 80);
  }

  stopTimer(): void {
    if (this.timerHandle) { clearInterval(this.timerHandle); this.timerHandle = null; }
  }

  private updateHUDBar(elapsed: number, cps: number): void {
    const timeEl = document.getElementById('hudTypingTime');
    const cpsEl  = document.getElementById('hudTypingSpeed');
    const bar    = document.getElementById('hudTypingBar');
    const warn   = document.getElementById('hudTypingWarn');

    if (timeEl) timeEl.innerText = `${elapsed.toFixed(1)}s / Max ${this.adminMaxTyping.toFixed(1)}s`;
    if (cpsEl)  cpsEl.innerText  = `${cps.toFixed(1)} chars/s`;
    if (bar) {
      const pct = Math.min(100, (elapsed / this.adminMaxTyping) * 100);
      bar.style.width = `${pct}%`;
      const danger = elapsed > this.adminMaxTyping;
      bar.className = `h-full rounded-full transition-all duration-150 ${
        danger
          ? 'bg-gradient-to-r from-amber-400 to-red-500'
          : 'bg-gradient-to-r from-cyan-400 to-blue-500'
      }`;
      if (warn) {
        warn.classList.toggle('hidden', !danger);
        if (danger) warn.innerText = `⚠️ LIMIT EXCEEDED (${elapsed.toFixed(1)}s > ${this.adminMaxTyping}s): ANOMALY FLAGGED`;
      }
    }
  }

  private updateGeoDOM(): void {
    const el = document.getElementById('sensorLocation');
    if (!el) return;
    const tag = this.locationSource === 'gps' ? '🛰 GPS' 
              : this.locationSource === 'ip' ? '🌐 IP' : '⚠ BASELINE';
    el.innerText = `${this.location.city} (${this.location.lat}, ${this.location.lng})`;
    el.title = `Location source: ${tag}`;
  }

  /* ─── Public Methods ─────────────────────────────────────── */
  getPayload(): BehavioralPayload {
    this.stopTimer();
    return {
      typing_duration_sec:  Math.max(0.5, +this.typingDurationSec.toFixed(2)),
      keystroke_intervals:  this.keyIntervals,
      latitude:             this.location.lat,
      longitude:            this.location.lng,
      city:                 this.location.city,
      login_hour:           new Date().getHours(),
      mouse_events_count:   this.mouseCount
    };
  }

  simulateLocation(city: string, lat: number, lng: number): void {
    this.locationLocked = true;
    this.locationSource = 'fallback';
    this.location = { city, lat, lng };
    this.updateGeoDOM();
  }

  simulateTyping(sec: number): void {
    this.typingDurationSec = sec;
    this.keyIntervals = [180, 290, 210, 340];
    this.updateHUDBar(sec, 8 / sec);
  }
}
