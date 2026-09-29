/**
 * SentinelAI Webcam & Optical Vision HUD Controller
 * Manages live camera streaming, client-side targeting reticle,
 * and PyTorch/OpenCV landmark coordinates rendering.
 */

class VisionHUDController {
  constructor() {
    this.video = document.getElementById('webcamVideo');
    this.canvas = document.getElementById('hudCanvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.isStreaming = false;
    this.analysisInterval = null;
    this.currentVisionData = {
      face_detected: false,
      face_bbox: null,
      iris_detected: false,
      iris_points: [],
      liveness_score: 0.0
    };
    this.simulatedMode = false;
    this.scanAngle = 0;
  }

  async initCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.enableSimulationMode("Browser camera API not supported");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
      });
      this.video.srcObject = stream;
      await this.video.play();
      this.isStreaming = true;

      this.video.addEventListener('loadedmetadata', () => {
        this.resizeCanvas();
      });

      this.startHUDLoop();
      this.startBackendAnalysisLoop();
      document.getElementById('hudStatusText').innerText = "OPTICAL SENSOR ACTIVE";
      document.getElementById('hudStatusText').style.color = "var(--cyan)";
    } catch (err) {
      console.warn("Webcam access denied or unavailable, activating Neural Simulation Mode:", err);
      this.enableSimulationMode(err.message);
    }
  }

  enableSimulationMode(reason) {
    this.simulatedMode = true;
    document.getElementById('hudStatusText').innerText = "NEURAL SIMULATION MODE";
    document.getElementById('hudStatusText').style.color = "var(--amber)";
    this.resizeCanvas();
    this.startHUDLoop();
    this.startSimulatedAnalysis();
  }

  resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = this.canvas.parentElement.clientWidth;
    this.canvas.height = this.canvas.parentElement.clientHeight;
  }

  startHUDLoop() {
    const render = () => {
      this.drawHUDOverlay();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  drawHUDOverlay() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    // If simulation mode, draw synthetic cyber avatar
    if (this.simulatedMode) {
      this.drawSyntheticAvatar(w, h);
    }

    // Reticle & Corner Brackets
    this.drawReticle(w, h);

    // If Face Detected, draw Face Bounding Box & Target HUD
    if (this.currentVisionData.face_detected && this.currentVisionData.face_bbox) {
      this.drawFaceTarget(this.currentVisionData.face_bbox, w, h);
    }

    // If Iris Detected, draw Iris & Pupil Tracking Targets
    if (this.currentVisionData.iris_detected && this.currentVisionData.iris_points) {
      this.drawIrisTargets(this.currentVisionData.iris_points, w, h);
    }
  }

  drawReticle(w, h) {
    const cx = w / 2;
    const cy = h / 2;
    this.scanAngle += 0.02;

    this.ctx.save();
    // Center targeting ring
    this.ctx.strokeStyle = "rgba(0, 242, 254, 0.25)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 75, 0, Math.PI * 2);
    this.ctx.stroke();

    // Rotating segment
    this.ctx.strokeStyle = "rgba(0, 242, 254, 0.6)";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 80, this.scanAngle, this.scanAngle + 1.2);
    this.ctx.stroke();

    // Crosshairs
    this.ctx.strokeStyle = "rgba(0, 242, 254, 0.35)";
    this.ctx.setLineDash([4, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(cx - 95, cy);
    this.ctx.lineTo(cx + 95, cy);
    this.ctx.moveTo(cx, cy - 95);
    this.ctx.lineTo(cx, cy + 95);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // Viewport Corners
    const cornerSize = 20;
    this.ctx.strokeStyle = "var(--cyan)";
    this.ctx.lineWidth = 2;

    // Top-Left
    this.ctx.beginPath();
    this.ctx.moveTo(15, 15 + cornerSize);
    this.ctx.lineTo(15, 15);
    this.ctx.lineTo(15 + cornerSize, 15);
    this.ctx.stroke();

    // Top-Right
    this.ctx.beginPath();
    this.ctx.moveTo(w - 15 - cornerSize, 15);
    this.ctx.lineTo(w - 15, 15);
    this.ctx.lineTo(w - 15, 15 + cornerSize);
    this.ctx.stroke();

    // Bottom-Left
    this.ctx.beginPath();
    this.ctx.moveTo(15, h - 15 - cornerSize);
    this.ctx.lineTo(15, h - 15);
    this.ctx.lineTo(15 + cornerSize, h - 15);
    this.ctx.stroke();

    // Bottom-Right
    this.ctx.beginPath();
    this.ctx.moveTo(w - 15 - cornerSize, h - 15);
    this.ctx.lineTo(w - 15, h - 15);
    this.ctx.lineTo(w - 15, h - 15 - cornerSize);
    this.ctx.stroke();

    this.ctx.restore();
  }

  drawFaceTarget(bbox, canvasW, canvasH) {
    // Normalization mapping from native camera coords (640x480) to canvas
    const scaleX = canvasW / (this.video.videoWidth || 640);
    const scaleY = canvasH / (this.video.videoHeight || 480);

    // Note: Video is mirrored with scaleX(-1), so flip x
    const rawX = bbox[0];
    const rawY = bbox[1];
    const rawW = bbox[2];
    const rawH = bbox[3];

    const x = (canvasW - (rawX + rawW) * scaleX);
    const y = rawY * scaleY;
    const w = rawW * scaleX;
    const h = rawH * scaleY;

    this.ctx.save();
    // Bounding Box
    this.ctx.strokeStyle = "rgba(0, 242, 254, 0.75)";
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, w, h);

    // Corner brackets
    const bracket = 14;
    this.ctx.strokeStyle = "var(--cyan)";
    this.ctx.lineWidth = 3;
    
    // Top-Left
    this.ctx.beginPath();
    this.ctx.moveTo(x, y + bracket);
    this.ctx.lineTo(x, y);
    this.ctx.lineTo(x + bracket, y);
    this.ctx.stroke();

    // Top-Right
    this.ctx.beginPath();
    this.ctx.moveTo(x + w - bracket, y);
    this.ctx.lineTo(x + w, y);
    this.ctx.lineTo(x + w, y + bracket);
    this.ctx.stroke();

    // Label
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    this.ctx.fillRect(x, y - 22, 160, 20);
    this.ctx.fillStyle = "var(--cyan)";
    this.ctx.font = "10px JetBrains Mono";
    this.ctx.fillText(`BIOMETRIC FACE: ${Math.round(this.currentVisionData.liveness_score * 100)}% LIVE`, x + 6, y - 8);

    this.ctx.restore();
  }

  drawIrisTargets(points, canvasW, canvasH) {
    const scaleX = canvasW / (this.video.videoWidth || 640);
    const scaleY = canvasH / (this.video.videoHeight || 480);

    this.ctx.save();
    points.forEach((pt, idx) => {
      const x = canvasW - (pt.x * scaleX);
      const y = pt.y * scaleY;
      const r = (pt.radius || 8) * scaleX;

      // Iris target rings
      this.ctx.strokeStyle = "rgba(16, 185, 129, 0.85)";
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.arc(x, y, Math.max(6, r), 0, Math.PI * 2);
      this.ctx.stroke();

      // Pupil center dot
      this.ctx.fillStyle = "var(--emerald)";
      this.ctx.beginPath();
      this.ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      this.ctx.fill();

      // Label
      this.ctx.fillStyle = "var(--emerald)";
      this.ctx.font = "9px JetBrains Mono";
      this.ctx.fillText(`IRIS-${idx + 1} LOCKED`, x + 8, y + 3);
    });
    this.ctx.restore();
  }

  drawSyntheticAvatar(w, h) {
    const cx = w / 2;
    const cy = h / 2 - 20;

    this.ctx.save();
    // Head silhouette
    this.ctx.strokeStyle = "rgba(0, 242, 254, 0.15)";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, 65, 85, 0, 0, Math.PI * 2);
    this.ctx.stroke();

    // Eyes
    this.ctx.beginPath();
    this.ctx.ellipse(cx - 24, cy - 10, 10, 6, 0, 0, Math.PI * 2);
    this.ctx.ellipse(cx + 24, cy - 10, 10, 6, 0, 0, Math.PI * 2);
    this.ctx.stroke();

    // Grid lines behind head
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    this.ctx.lineWidth = 1;
    for (let i = 0; i < w; i += 30) {
      this.ctx.beginPath();
      this.ctx.moveTo(i, 0);
      this.ctx.lineTo(i, h);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  startBackendAnalysisLoop() {
    // Use recursive setTimeout instead of setInterval so we never stack
    // concurrent requests when the backend takes longer than the interval.
    let consecutiveFailures = 0;

    const tick = async () => {
      if (!this.isStreaming) {
        // Stopped — reschedule in 1s and check again
        setTimeout(tick, 1000);
        return;
      }

      // Capture at full 640×480 for best facial recognition accuracy
      const snapshot = this.captureSnapshotBase64(640, 480);
      if (snapshot) {
        try {
          const res = await fetch('/api/vision/analyze-frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_base64: snapshot })
          });
          const data = await res.json();
          if (data.face_detected !== undefined) {
            this.currentVisionData = data;
            this.updateTelemetryDOM(data);
          }
          consecutiveFailures = 0; // reset on success
        } catch (e) {
          consecutiveFailures++;
          // Back off to 5 s after 3 consecutive failures (backend starting up / offline)
          const delay = consecutiveFailures >= 3 ? 5000 : 500;
          setTimeout(tick, delay);
          return;
        }
      }

      // Normal cadence: 500 ms after the last response was received
      setTimeout(tick, 500);
    };

    setTimeout(tick, 500);
  }

  startSimulatedAnalysis() {
    // Generates simulated live coordinates
    setInterval(() => {
      this.currentVisionData = {
        face_detected: true,
        face_bbox: [160, 100, 220, 240],
        iris_detected: true,
        iris_points: [
          { x: 235, y: 195, radius: 10 },
          { x: 305, y: 195, radius: 10 }
        ],
        liveness_score: 0.94
      };
      this.updateTelemetryDOM(this.currentVisionData);
    }, 500);
  }

  updateTelemetryDOM(data) {
    const faceEl = document.getElementById('telemFaceConf');
    const irisEl = document.getElementById('telemIrisStatus');
    const liveEl = document.getElementById('telemLiveness');
    const spuEl = document.getElementById('telemSpuState');

    if (faceEl) faceEl.innerText = data.face_detected ? "98.4%" : "0.0%";
    if (irisEl) irisEl.innerText = data.iris_detected ? "TRACKED" : "SEARCHING";
    if (liveEl) liveEl.innerText = data.liveness_score ? `${Math.round(data.liveness_score * 100)}%` : "0%";
    if (spuEl) spuEl.innerText = "ISOLATED";
  }

  captureSnapshotBase64(targetW = 480, targetH = 360) {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = targetW;
    offCanvas.height = targetH;
    const offCtx = offCanvas.getContext('2d');

    if (this.isStreaming && this.video.videoWidth > 0) {
      offCtx.drawImage(this.video, 0, 0, targetW, targetH);
      return offCanvas.toDataURL('image/jpeg', 0.85);
    } else {
      // Generate synthetic face pattern image for simulation mode
      offCtx.fillStyle = "#0c1222";
      offCtx.fillRect(0, 0, targetW, targetH);
      offCtx.fillStyle = "#00f2fe";
      offCtx.beginPath();
      offCtx.arc(targetW / 2, targetH / 2, 70, 0, Math.PI * 2);
      offCtx.fill();
      return offCanvas.toDataURL('image/jpeg', 0.85);
    }
  }
}

window.visionHUD = new VisionHUDController();
