/**
 * SentinelAI Behavioral Keystroke Dynamics & Sensor Engine
 * Measures typing speed, inter-key cadence, mouse movement entropy, and geo coordinates.
 */

class BehavioralSensorEngine {
  constructor() {
    this.keyPressTimestamps = [];
    this.keyIntervals = [];
    this.typingStartTime = null;
    this.typingDurationSec = 0;
    this.mouseEventsCount = 0;
    this.lastMousePos = { x: 0, y: 0 };
    this.mouseEntropyScore = 0;
    
    // Geolocation default (San Francisco baseline)
    this.currentLocation = {
      lat: 37.7749,
      lng: -122.4194,
      city: "San Francisco, CA"
    };

    this.adminMaxTypingSec = 7.5; // Synced with backend policy
    this.isTracking = false;
    this.timerInterval = null;

    this.initSensors();
  }

  initSensors() {
    // 1. Mouse Entropy Tracking
    window.addEventListener('mousemove', (e) => {
      this.mouseEventsCount++;
      const dx = e.clientX - this.lastMousePos.x;
      const dy = e.clientY - this.lastMousePos.y;
      this.mouseEntropyScore += Math.abs(dx) + Math.abs(dy);
      this.lastMousePos = { x: e.clientX, y: e.clientY };
    });

    // 2. Browser Geolocation API
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentLocation.lat = parseFloat(pos.coords.latitude.toFixed(4));
          this.currentLocation.lng = parseFloat(pos.coords.longitude.toFixed(4));
          this.currentLocation.city = "Local GPS Client";
          this.updateGeoDOM();
        },
        (err) => {
          console.log("GPS access ungranted or local dev; using IP default:", err.message);
          this.updateGeoDOM();
        },
        { timeout: 4000 }
      );
    }

    // 3. Attach Password Field Keystroke Listeners
    const pwdInput = document.getElementById('authPassword');
    if (pwdInput) {
      pwdInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
      pwdInput.addEventListener('focus', () => this.handleFocus());
    }

    // Update Geo DOM immediately
    this.updateGeoDOM();
  }

  handleFocus() {
    // Reset dynamics on new attempt
    this.keyPressTimestamps = [];
    this.keyIntervals = [];
    this.typingStartTime = null;
    this.typingDurationSec = 0;
    this.updateHUDProgressBar(0, 0);
  }

  handleKeyDown(e) {
    // Ignore meta keys
    if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;

    const now = performance.now();
    if (!this.typingStartTime) {
      this.typingStartTime = now;
      this.startDurationTimer();
    } else {
      const last = this.keyPressTimestamps[this.keyPressTimestamps.length - 1];
      const interval = now - last;
      this.keyIntervals.push(interval);
    }

    this.keyPressTimestamps.push(now);
    const charCount = document.getElementById('authPassword').value.length + 1;
    const elapsedSec = (now - this.typingStartTime) / 1000;
    const cps = elapsedSec > 0 ? (charCount / elapsedSec).toFixed(1) : "0.0";

    this.updateHUDProgressBar(elapsedSec, cps);
  }

  startDurationTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.typingStartTime) return;
      const now = performance.now();
      this.typingDurationSec = (now - this.typingStartTime) / 1000;
      const pwdVal = document.getElementById('authPassword').value;
      const cps = this.typingDurationSec > 0 ? (pwdVal.length / this.typingDurationSec).toFixed(1) : "0.0";
      this.updateHUDProgressBar(this.typingDurationSec, cps);
    }, 100);
  }

  stopDurationTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateHUDProgressBar(elapsedSec, cps) {
    const timeValEl = document.getElementById('hudTypingTime');
    const cpsValEl = document.getElementById('hudTypingSpeed');
    const barEl = document.getElementById('hudTypingBar');
    const warnEl = document.getElementById('hudTypingWarn');

    if (timeValEl) timeValEl.innerText = `${elapsedSec.toFixed(1)}s / Max ${this.adminMaxTypingSec.toFixed(1)}s`;
    if (cpsValEl) cpsValEl.innerText = `${cps} chars/s`;

    if (barEl) {
      const pct = Math.min(100, (elapsedSec / this.adminMaxTypingSec) * 100);
      barEl.style.width = `${pct}%`;

      if (elapsedSec > this.adminMaxTypingSec) {
        barEl.classList.add('danger');
        if (warnEl) {
          warnEl.style.display = 'block';
          warnEl.innerText = `⚠️ LIMIT EXCEEDED (${elapsedSec.toFixed(1)}s > ${this.adminMaxTypingSec}s): ANOMALY DETECTED`;
        }
      } else {
        barEl.classList.remove('danger');
        if (warnEl) warnEl.style.display = 'none';
      }
    }
  }

  updateGeoDOM() {
    const geoEl = document.getElementById('sensorLocation');
    if (geoEl) {
      geoEl.innerText = `${this.currentLocation.city} (${this.currentLocation.lat}, ${this.currentLocation.lng})`;
    }
    const timeEl = document.getElementById('sensorTime');
    if (timeEl) {
      const now = new Date();
      timeEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  getTelemetryPayload() {
    this.stopDurationTimer();
    const finalDuration = Math.max(0.4, parseFloat(this.typingDurationSec.toFixed(2)));
    return {
      typing_duration_sec: finalDuration,
      keystroke_intervals: this.keyIntervals,
      latitude: this.currentLocation.lat,
      longitude: this.currentLocation.lng,
      city: this.currentLocation.city,
      login_hour: new Date().getHours(),
      mouse_events_count: this.mouseEventsCount
    };
  }

  setSimulatedLocation(city, lat, lng) {
    this.currentLocation = { city, lat, lng };
    this.updateGeoDOM();
  }

  setSimulatedTypingDuration(sec) {
    this.typingDurationSec = sec;
    this.keyIntervals = [200, 350, 180, 220];
    this.updateHUDProgressBar(sec, (8 / sec).toFixed(1));
  }
}

window.behavioralSensors = new BehavioralSensorEngine();
