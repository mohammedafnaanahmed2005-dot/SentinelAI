// ============================================================
//  SentinelAI – Vision HUD Controller (TypeScript)
//  Manages webcam streaming, PyTorch/OpenCV coordinate rendering,
//  face bounding box targeting, and iris pupil crosshairs.
// ============================================================

import type { VisionFrameResponse, IrisPoint } from './types.ts';

export class VisionHUDController {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private stream: MediaStream | null = null;
  public isStreaming = false;
  public isSimulated = false;
  private analysisTimer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive unreachable-backend poll failures (drives retry backoff). */
  private pollFailures = 0;
  private scanAngle = 0;
  /**
   * Pixel dimensions of the frame actually sent to the backend for analysis.
   * The returned face/iris coordinates live in THIS space, so the HUD must
   * normalise against it (not the raw video size) or boxes render misaligned.
   */
  private analysisDims = { w: 640, h: 480 };
  /**
   * Most recent snapshot that the backend CONFIRMED contains a detected face.
   * Submitting this frame (instead of whatever random frame is live at click
   * time) is what makes face matching reliable for registered users.
   */
  private lastGoodSnapshot: string | null = null;
  /** Highest liveness (sharpness) seen so far; drives best-snapshot selection. */
  private bestLiveness = 0;
  /** True when the physical camera could not be opened (permission/busy/none). */
  public cameraUnavailable = false;
  /** Human-readable reason + fix for the camera failure, shown in the HUD. */
  public cameraErrorReason = '';
  private cameraRetryTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether a black-feed warning is currently shown (to restore on recovery). */
  private blackWarned = false;
  public currentVision: VisionFrameResponse = {
    face_detected: false,
    face_bbox: null,
    iris_detected: false,
    iris_points: [],
    liveness_score: 0,
    message: ''
  } as VisionFrameResponse;

  constructor() {
    this.video   = document.getElementById('webcamVideo')   as HTMLVideoElement;
    this.canvas  = document.getElementById('hudCanvas')     as HTMLCanvasElement;
    this.ctx     = this.canvas?.getContext('2d') ?? null;
  }

  async initCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.activateSimulation('Camera API unavailable');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.isStreaming = true;
      this.cameraUnavailable = false;
      this.cameraErrorReason = '';
      if (this.cameraRetryTimer) { clearInterval(this.cameraRetryTimer); this.cameraRetryTimer = null; }
      this.video.addEventListener('loadedmetadata', () => this.resizeCanvas());
      this.setHUDStatus('OPTICAL SENSOR ACTIVE', 'text-cyan-400');
      this.startHUDLoop();
      this.startBackendPolling();
    } catch (err) {
      // NEVER silently fall back to a fake face here: a simulated frame can
      // never pass real biometric verification and hides the true cause.
      // Surface the exact reason and keep probing so the feed recovers the
      // moment permission is granted / the device is freed, without a reload.
      this.activateCameraUnavailable(this.describeCameraError(err));
    }
  }

  private describeCameraError(err: unknown): string {
    const name = (err as DOMException)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError')
      return 'Camera permission denied. Click the lock/icon in the address bar, allow Camera, then it reconnects automatically.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError')
      return 'No camera device found. Connect/enable a webcam - it reconnects automatically.';
    if (name === 'NotReadableError' || name === 'AbortError')
      return 'Camera is busy (another app is using it). Close other camera apps - it reconnects automatically.';
    return 'Camera unavailable. Use http://localhost (not a LAN IP) and allow camera access in Windows privacy settings.';
  }

  private activateCameraUnavailable(reason: string): void {
    this.cameraUnavailable = true;
    this.cameraErrorReason = reason;
    this.isStreaming = false;
    this.isSimulated = false;
    this.setHUDStatus('CAMERA UNAVAILABLE - retrying…', 'text-red-400');
    this.resizeCanvas();
    this.startHUDLoop();
    if (!this.cameraRetryTimer) {
      this.cameraRetryTimer = setInterval(() => { void this.initCamera(); }, 4000);
    }
  }

  private activateSimulation(reason: string): void {
    this.isSimulated = true;
    this.setHUDStatus(`NEURAL SIMULATION MODE (${reason})`, 'text-amber-400');
    this.resizeCanvas();
    this.startHUDLoop();
    this.startSimulation();
  }

  private setHUDStatus(text: string, cls: string): void {
    const el = document.getElementById('hudStatusText');
    if (!el) return;
    el.innerText = text;
    el.className = `font-mono text-[11px] animate-pulse ${cls}`;
  }

  resizeCanvas(): void {
    if (!this.canvas) return;
    this.canvas.width  = this.canvas.parentElement!.clientWidth;
    this.canvas.height = this.canvas.parentElement!.clientHeight;
  }

  private startHUDLoop(): void {
    const render = (): void => {
      this.drawHUD();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  private drawHUD(): void {
    if (!this.ctx || !this.canvas) return;
    const { width: w, height: h } = this.canvas;
    this.ctx.clearRect(0, 0, w, h);

    if (this.isSimulated) this.drawSyntheticBG(w, h);
    this.drawReticle(w, h);
    if (this.currentVision.face_detected && this.currentVision.face_bbox) {
      this.drawFaceBBox(this.currentVision.face_bbox, w, h);
    }
    if (this.currentVision.iris_detected) {
      this.drawIrisTargets(this.currentVision.iris_points, w, h);
    }
  }

  private drawReticle(w: number, h: number): void {
    const cx = w / 2, cy = h / 2;
    this.scanAngle += 0.018;

    this.ctx!.save();
    // Outer ring
    this.ctx!.strokeStyle = 'rgba(0,242,254,0.18)';
    this.ctx!.lineWidth = 1;
    this.ctx!.beginPath();
    this.ctx!.arc(cx, cy, 70, 0, Math.PI * 2);
    this.ctx!.stroke();

    // Rotating arc
    this.ctx!.strokeStyle = 'rgba(0,242,254,0.7)';
    this.ctx!.lineWidth = 2;
    this.ctx!.beginPath();
    this.ctx!.arc(cx, cy, 76, this.scanAngle, this.scanAngle + 1.1);
    this.ctx!.stroke();

    // Crosshairs
    this.ctx!.strokeStyle = 'rgba(0,242,254,0.3)';
    this.ctx!.setLineDash([4, 6]);
    this.ctx!.beginPath();
    this.ctx!.moveTo(cx - 90, cy); this.ctx!.lineTo(cx + 90, cy);
    this.ctx!.moveTo(cx, cy - 90); this.ctx!.lineTo(cx, cy + 90);
    this.ctx!.stroke();
    this.ctx!.setLineDash([]);

    // Corner brackets
    const cs = 18;
    this.ctx!.strokeStyle = '#00f2fe';
    this.ctx!.lineWidth = 2;
    [[12, 12, 1, 1], [w - 12, 12, -1, 1], [12, h - 12, 1, -1], [w - 12, h - 12, -1, -1]].forEach(
      ([bx, by, dx, dy]) => {
        this.ctx!.beginPath();
        this.ctx!.moveTo(bx, by + dy * cs);
        this.ctx!.lineTo(bx, by);
        this.ctx!.lineTo(bx + dx * cs, by);
        this.ctx!.stroke();
      }
    );
    this.ctx!.restore();
  }

  private drawFaceBBox(
    bbox: [number, number, number, number],
    cw: number, ch: number
  ): void {
    const nW = this.analysisDims.w;
    const nH = this.analysisDims.h;
    const sx = cw / nW, sy = ch / nH;

    // Mirrored X because video is CSS-mirrored (scaleX(-1))
    const x = cw - (bbox[0] + bbox[2]) * sx;
    const y = bbox[1] * sy;
    const w = bbox[2] * sx;
    const h = bbox[3] * sy;
    const cs = 14;

    this.ctx!.save();
    this.ctx!.strokeStyle = 'rgba(0,242,254,0.65)';
    this.ctx!.lineWidth = 1.5;
    this.ctx!.strokeRect(x, y, w, h);

    this.ctx!.strokeStyle = '#00f2fe';
    this.ctx!.lineWidth = 2.5;
    [[x, y, 1, 1], [x+w, y, -1, 1], [x, y+h, 1, -1], [x+w, y+h, -1, -1]].forEach(
      ([bx, by, dx, dy]) => {
        this.ctx!.beginPath();
        this.ctx!.moveTo(bx, by + dy * cs);
        this.ctx!.lineTo(bx, by);
        this.ctx!.lineTo(bx + dx * cs, by);
        this.ctx!.stroke();
      }
    );

    const live = Math.round(this.currentVision.liveness_score * 100);
    this.ctx!.fillStyle = 'rgba(0,0,0,0.7)';
    this.ctx!.fillRect(x, y - 22, 168, 20);
    this.ctx!.fillStyle = '#00f2fe';
    this.ctx!.font = '10px JetBrains Mono';
    this.ctx!.fillText(`BIOMETRIC FACE  ${live}% LIVENESS`, x + 5, y - 7);
    this.ctx!.restore();
  }

  private drawIrisTargets(points: IrisPoint[], cw: number, ch: number): void {
    const nW = this.analysisDims.w;
    const nH = this.analysisDims.h;
    const sx = cw / nW, sy = ch / nH;

    this.ctx!.save();
    points.forEach((pt, i) => {
      const x = cw - pt.x * sx;
      const y = pt.y * sy;
      const r = Math.max(7, pt.radius * sx);

      this.ctx!.strokeStyle = 'rgba(16,185,129,0.85)';
      this.ctx!.lineWidth = 1.5;
      this.ctx!.beginPath();
      this.ctx!.arc(x, y, r, 0, Math.PI * 2);
      this.ctx!.stroke();

      this.ctx!.fillStyle = '#10b981';
      this.ctx!.beginPath();
      this.ctx!.arc(x, y, 2.5, 0, Math.PI * 2);
      this.ctx!.fill();

      this.ctx!.fillStyle = '#10b981';
      this.ctx!.font = '9px JetBrains Mono';
      this.ctx!.fillText(`IRIS-${i + 1} LOCKED`, x + 10, y + 3);
    });
    this.ctx!.restore();
  }

  private drawSyntheticBG(w: number, h: number): void {
    const cx = w / 2, cy = h / 2 - 15;
    this.ctx!.save();
    this.ctx!.strokeStyle = 'rgba(0,242,254,0.12)';
    this.ctx!.lineWidth = 1.5;
    this.ctx!.beginPath();
    this.ctx!.ellipse(cx, cy, 60, 80, 0, 0, Math.PI * 2);
    this.ctx!.stroke();
    this.ctx!.beginPath();
    this.ctx!.ellipse(cx - 22, cy - 10, 10, 6, 0, 0, Math.PI * 2);
    this.ctx!.ellipse(cx + 22, cy - 10, 10, 6, 0, 0, Math.PI * 2);
    this.ctx!.stroke();
    this.ctx!.restore();
  }

  /**
   * Keep ONLY the sharpest backend-confirmed face frame. When polling uses a
   * smaller resolution, we store the POLL snap for HUD confirmation but
   * ALWAYS re-capture at full 640×480 for authentication so face matching
   * has enough detail to work reliably.
   */
  private rememberGoodSnapshot(snap: string, data: VisionFrameResponse): void {
    if (!data.face_detected) return;
    if (data.liveness_score < 0.3) return;
    if (data.liveness_score > this.bestLiveness) {
      this.bestLiveness = data.liveness_score;
      // Always store a full-resolution snapshot for authentication —
      // the poll snap may be 320×240 which is too small for SFace matching.
      const fullSnap = this.captureSnapshot(640, 480, 0.92);
      this.lastGoodSnapshot = fullSnap ?? snap;
    }
  }

  /** Reflect a black camera feed (shutter/cover/busy) in the HUD status line. */
  private applyFeedStatus(data: VisionFrameResponse): void {
    if (data.frame_black) {
      this.blackWarned = true;
      this.setHUDStatus('CAMERA FEED BLACK — open shutter / add light', 'text-amber-400');
    } else if (this.blackWarned) {
      this.blackWarned = false;
      this.setHUDStatus('OPTICAL SENSOR ACTIVE', 'text-cyan-400');
    }
  }

  private startBackendPolling(): void {
    // Recursive timeout (not setInterval) so the cadence can back off. When the
    // backend is unreachable we must NOT hammer the Vite proxy every 450ms -
    // that floods the console with ECONNREFUSED. Instead probe slowly until
    // the backend returns, then resume the fast analysis cadence.
    const tick = async (): Promise<void> => {
      let delay = 450;
      if (this.isStreaming) {
        const ok = await this.pollOnce();
        if (!ok) delay = this.pollFailures > 2 ? 5000 : 1500;
      }
      this.analysisTimer = setTimeout(tick, delay);
    };
    this.analysisTimer = setTimeout(tick, 450);
  }

  /** One analysis round-trip. Returns false when the backend is unreachable. */
  private async pollOnce(): Promise<boolean> {
    // 320×240 is sufficient for YuNet face detection and keeps the base64
    // payload ~25 KB — well under h11's body size limit. 640×480 was ~200 KB
    // which caused ECONNRESET on every poll with h11 0.16+.
    const AW = 320, AH = 240;
    // Use lower JPEG quality for polling (detection only) — ~15 KB payload.
    // getBestSnapshot still captures at 640×480 q=0.92 for authentication.
    const snap = this.captureSnapshot(AW, AH, 0.70);
    if (!snap) return true;
    this.analysisDims = { w: AW, h: AH };
    try {
      const res = await fetch('/api/vision/analyze-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: snap })
      });
      const data = await res.json() as VisionFrameResponse;
      const wasOffline = this.pollFailures > 2;
      this.pollFailures = 0;
      if (wasOffline) this.setHUDStatus('OPTICAL SENSOR ACTIVE', 'text-cyan-400');
      if (data.face_detected !== undefined) {
        this.currentVision = data;
        this.updateTelemetry(data);
        this.applyFeedStatus(data);
        this.rememberGoodSnapshot(snap, data);
      }
      return true;
    } catch {
      this.pollFailures++;
      // After a few consecutive failures, surface a clear offline state once
      // (instead of spamming the proxy) and slow the retry right down.
      if (this.pollFailures === 3) {
        this.setHUDStatus('BACKEND OFFLINE — run: python run.py', 'text-red-400');
        this.currentVision = {
          face_detected: false, face_bbox: null, iris_detected: false,
          iris_points: [], liveness_score: 0,
          message: 'Backend unreachable - start the FastAPI server (python run.py).'
        } as VisionFrameResponse;
        this.updateTelemetry(this.currentVision);
      }
      return false;
    }
  }

  private startSimulation(): void {
    setInterval(() => {
      this.currentVision = {
        face_detected: true,
        face_bbox: [155, 95, 215, 235],
        iris_detected: true,
        iris_points: [
          { x: 230, y: 190, radius: 11, eye_box: [210, 170, 42, 40] },
          { x: 305, y: 190, radius: 11, eye_box: [285, 170, 42, 40] }
        ],
        liveness_score: 0.94,
        message: 'Simulation'
      };
      this.updateTelemetry(this.currentVision);
    }, 500);
  }

  private updateTelemetry(data: VisionFrameResponse): void {
    const get = (id: string): HTMLElement | null => document.getElementById(id);
    const faceEl = get('telemFaceConf');
    const irisEl = get('telemIrisStatus');
    const liveEl = get('telemLiveness');
    const faceLabel = get('faceStatusLabel');
    const irisLabel = get('irisStatusLabel');

    if (faceEl) faceEl.innerText = data.face_detected ? '98.4%' : '0.0%';
    if (irisEl) irisEl.innerText = data.iris_detected ? 'TRACKED' : 'SEARCHING';
    if (liveEl) liveEl.innerText = `${Math.round(data.liveness_score * 100)}%`;
    if (faceLabel) faceLabel.innerText = data.face_detected ? 'FACE DETECTED ✓' : 'SCANNING FOR FACE...';
    if (irisLabel) irisLabel.innerText = data.iris_detected ? 'IRIS: LOCKED ✓' : 'IRIS: SEARCHING';
  }

  /**
   * One confirmatory analysis of a FRESH frame, used at sign-in click time.
   * The 450ms poll state can be stale or empty (e.g. immediately after the
   * backend restarts, or if polling momentarily lost the face); re-confirming
   * against the backend here stops a genuine face from being rejected as
   * "no live face" the instant the user clicks Verify.
   */
  async analyzeOnce(): Promise<boolean> {
    const snap = this.captureSnapshot(this.analysisDims.w, this.analysisDims.h);
    if (!snap) return this.currentVision.face_detected;
    try {
      const res = await fetch('/api/vision/analyze-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: snap })
      });
      const data = await res.json() as VisionFrameResponse;
      if (data.face_detected !== undefined) {
        this.currentVision = data;
        this.updateTelemetry(data);
        this.applyFeedStatus(data);
        this.rememberGoodSnapshot(snap, data);
      }
      return !!data.face_detected;
    } catch {
      return this.currentVision.face_detected;
    }
  }

  captureSnapshot(w = 640, h = 480, quality = 0.92): string | null {
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d')!;
    if (this.isStreaming && this.video.videoWidth > 0) {
      ctx.drawImage(this.video, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#0c1222';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,242,254,0.4)';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 65, 0, Math.PI * 2);
      ctx.fill();
    }
    return off.toDataURL('image/jpeg', quality);
  }

  /** True when a backend-confirmed face frame is cached. */
  hasGoodSnapshot(): boolean {
    return !!this.lastGoodSnapshot;
  }

  /**
   * Best frame for authentication: the last snapshot the backend confirmed
   * contains a live face (avoids submitting a blurred/faceless click-time
   * frame, which previously hard-blocked genuine registered users).
   * Falls back to a fresh live capture if no confirmed snapshot is cached yet.
   */
  getBestSnapshot(w = 640, h = 480): string | null {
    return this.lastGoodSnapshot ?? this.captureSnapshot(w, h);
  }
}
