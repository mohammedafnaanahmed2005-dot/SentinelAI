/**
 * Snapdragon SPU Hardware Security Interactive Visualizer
 * Interactive demonstration of Qualcomm Snapdragon Secure Processing Unit,
 * QTEE, Hardware-isolated Biometric pipelines, and cryptographic coprocessors.
 */

class SnapdragonSecurityVisualizer {
  constructor() {
    this.currentStep = 1;
    this.autoCycleInterval = null;
  }

  init() {
    this.bindEvents();
    this.renderStep(1);
  }

  bindEvents() {
    const steps = document.querySelectorAll('.pipeline-step');
    steps.forEach((step, idx) => {
      step.addEventListener('click', () => {
        this.renderStep(idx + 1);
      });
    });

    const probeBtn = document.getElementById('btnRunSpuHardwareProbe');
    if (probeBtn) {
      probeBtn.addEventListener('click', () => this.runHardwareProbe());
    }
  }

  renderStep(stepIndex) {
    this.currentStep = stepIndex;
    const steps = document.querySelectorAll('.pipeline-step');
    steps.forEach((st, idx) => {
      if (idx + 1 === stepIndex) {
        st.classList.add('active');
      } else {
        st.classList.remove('active');
      }
    });

    const infoBox = document.getElementById('spuStepDetailBox');
    if (!infoBox) return;

    const stepData = [
      {
        title: "Stage 1: Spectra ISP Direct Sensor Channel",
        desc: "The camera sensor directly feeds raw infrared and RGB photons into the Qualcomm Spectra ISP. Unlike standard mobile OS pipelines where frames reside in shared Android Linux kernel memory, the Snapdragon Secure Camera driver routes frames strictly over a dedicated DMA channel directly to the SPU.",
        sub: "Prevents screen-capture malware, malicious camera HAL drivers, and memory-dump rootkits.",
        tech: "Hardware-enforced Memory Protection (MPU) | Non-root DMA Channel | Zero Kernel Buffering"
      },
      {
        title: "Stage 2: Secure Processing Unit (SPU) Physical Isolation",
        desc: "The Qualcomm SPU is an autonomous, on-die microcontroller integrated into the Snapdragon SoC with its own dedicated CPU, isolated SRAM, and hardware crypto accelerators. It operates completely independent of the Kryo Application CPU and Android OS.",
        sub: "Physical barrier: Even full root/jailbreak of Android OS cannot read or modify the SPU memory.",
        tech: "Arm TrustZone EL3 / EL1-S | Hardware Anti-tamper Glitch Sensors | Voltage Fluctuation Shield"
      },
      {
        title: "Stage 3: Hexagon NPU Secure Enclave Biometric Inference",
        desc: "A dedicated slice of the Qualcomm Hexagon NPU executes the PyTorch-optimized convolutional face embedding and iris tracking algorithms within the secure memory boundary. Biometric templates (512-d embeddings) never leave the SPU.",
        sub: "Ensures user facial features and iris scans are never converted to cloud-accessible images.",
        tech: "Sub-millimeter Pupil Depth Verification | 3D Infrared Liveness Detection | Vector Dot-product Acceleration"
      },
      {
        title: "Stage 4: Hardware Cryptographic Engine & Fused eFuses",
        desc: "The biometric match score is compared against the enrolled signature stored in encrypted Non-Volatile Memory. The encryption key is derived directly from Qualcomm Hardware eFuses burned into silicon during manufacturing and cannot be extracted via software.",
        sub: "FIPS 140-3 Level 3 & Common Criteria EAL4+ certified security boundary.",
        tech: "AES-256 GCM Accelerator | Hardware TRNG (True Random Number Generator) | Silicon-fused Unique Key"
      },
      {
        title: "Stage 5: Cryptographically Signed Authentication Token",
        desc: "Once verification succeeds, the SPU generates a single-use, HMAC-SHA256 cryptographically signed boolean token (AUTH_PERMIT) signed with the chip's private key. This token is passed to the Android High-Level OS, permitting immediate login.",
        sub: "Zero-knowledge assertion: The OS receives proof of authentication without ever touching biometric data.",
        tech: "NIST P-384 ECDSA Token | Monotonic Anti-Replay Counter | FIDO2 / WebAuthn Hardware Authenticator"
      }
    ];

    const current = stepData[stepIndex - 1];
    infoBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <h3 style="color: var(--cyan); font-family: var(--font-display); font-size: 1rem;">${current.title}</h3>
        <span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--emerald);">PHASE ${stepIndex} OF 5</span>
      </div>
      <p style="font-size: 0.85rem; color: #f8fafc; line-height: 1.6; margin-bottom: 0.75rem;">${current.desc}</p>
      <div style="background: rgba(0, 242, 254, 0.05); border-left: 3px solid var(--cyan); padding: 0.6rem 0.8rem; margin-bottom: 0.75rem;">
        <span style="font-size: 0.75rem; color: var(--cyan); font-weight: 600;">Security Guarantee: </span>
        <span style="font-size: 0.75rem; color: #94a3b8;">${current.sub}</span>
      </div>
      <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #64748b;">
        <span style="color: var(--text-dim);">HARDWARE PRIMITIVES:</span> ${current.tech}
      </div>
    `;
  }

  async runHardwareProbe() {
    const probeLog = document.getElementById('spuProbeLog');
    if (!probeLog) return;

    probeLog.style.display = 'block';
    probeLog.innerHTML = `<span style="color: var(--cyan);">[SPU-DIAG] Initializing Qualcomm SPU Hardware Bus Audit...</span><br/>`;

    const logs = [
      "[SPU-HW] Scanning TrustZone EL3 boundary register: SECURE_STATE_LOCKED (OK)",
      "[SPU-HW] Spectra ISP direct DMA channel mapped: 0xF9000000 - 0xF9080000 [ISOLATED]",
      "[SPU-HW] Hexagon NPU Secure Context initialized: 512-d Tensor Engine Ready",
      "[SPU-HW] Testing Silicon eFuse Hash Integrity: SHA-256 Validated (Match OK)",
      "[SPU-HW] Hardware TRNG Entropy Pool: 4096-bit NIST SP 800-90A Certified",
      "[SPU-HW] Anti-Tamper Voltage/Clock Glitch Sensors: ACTIVE (0 Tamper Events)",
      "[SPU-HW] Status: SNAPDRAGON SPU BIOMETRIC PIPELINE HARDENED & ENFORCED."
    ];

    for (let i = 0; i < logs.length; i++) {
      await new Promise(r => setTimeout(r, 220));
      const line = document.createElement('div');
      line.style.color = (i === logs.length - 1) ? 'var(--emerald)' : '#94a3b8';
      line.style.fontSize = '0.72rem';
      line.style.fontFamily = 'var(--font-mono)';
      line.innerText = logs[i];
      probeLog.appendChild(line);
      probeLog.scrollTop = probeLog.scrollHeight;
    }
  }
}

window.snapdragonSec = new SnapdragonSecurityVisualizer();
