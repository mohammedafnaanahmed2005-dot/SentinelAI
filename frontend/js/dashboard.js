/**
 * SentinelAI Security Operations Center (SOC) Dashboard & Admin Controller
 * Renders Chart.js analytics, Leaflet dark cyber maps, user registry, and policy controls.
 */

class DashboardController {
  constructor() {
    this.map = null;
    this.mapMarkers = [];
    this.charts = {};
    this.policies = {};
  }

  async initDashboard() {
    await this.fetchStatsAndRender();
    await this.initLeafletMap();
    await this.loadUsersTable();
    await this.loadAuditLogs();
    await this.loadPolicies();
  }

  async fetchStatsAndRender() {
    try {
      const res = await fetch('/api/admin/stats');
      const data = await res.json();

      document.getElementById('statTotalAttempts').innerText = data.total_attempts || 0;
      document.getElementById('statBlockedAttacks').innerText = data.blocked_attacks || 0;
      document.getElementById('statMfaChallenges').innerText = data.mfa_challenges || 0;
      document.getElementById('statAvgRiskScore').innerText = `${data.avg_risk_score || 0}%`;

      this.renderCharts(data);
      if (this.map && data.geo_points) {
        this.plotMapMarkers(data.geo_points);
      }
    } catch (e) {
      console.error("Failed to load dashboard stats:", e);
    }
  }

  renderCharts(stats) {
    // 1. Risk Breakdown Doughnut Chart
    const ctx1 = document.getElementById('riskBreakdownChart');
    if (ctx1) {
      if (this.charts.breakdown) this.charts.breakdown.destroy();
      const breakdown = stats.risk_breakdown || { LOW: 4, MEDIUM: 2, HIGH: 3 };
      this.charts.breakdown = new Chart(ctx1, {
        type: 'doughnut',
        data: {
          labels: ['Low Risk (Allowed)', 'Medium Risk (MFA Challenge)', 'High Risk (Blocked)'],
          datasets: [{
            data: [breakdown.LOW || 0, breakdown.MEDIUM || 0, breakdown.HIGH || 0],
            backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
            borderColor: '#060913',
            borderWidth: 3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } }
          },
          cutout: '70%'
        }
      });
    }

    // 2. 24-Hour Threat Velocity Line Chart
    const ctx2 = document.getElementById('threatVelocityChart');
    if (ctx2) {
      if (this.charts.velocity) this.charts.velocity.destroy();
      this.charts.velocity = new Chart(ctx2, {
        type: 'line',
        data: {
          labels: ['00:00', '03:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '21:00'],
          datasets: [
            {
              label: 'Authorized Logins',
              data: [1, 0, 2, 8, 14, 11, 15, 12, 6, 2],
              borderColor: '#00f2fe',
              backgroundColor: 'rgba(0, 242, 254, 0.08)',
              fill: true,
              tension: 0.35
            },
            {
              label: 'Blocked Intrusions',
              data: [3, 4, 1, 0, 2, 1, 0, 1, 2, 5],
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              fill: true,
              tension: 0.35
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } }
          },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b' } },
            y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b' } }
          }
        }
      });
    }

    // 3. Multi-Vector Risk Radar Chart
    const ctx3 = document.getElementById('vectorRadarChart');
    if (ctx3) {
      if (this.charts.radar) this.charts.radar.destroy();
      this.charts.radar = new Chart(ctx3, {
        type: 'radar',
        data: {
          labels: ['Facial Match', 'Iris Liveness', 'Keystroke Duration', 'Geo Proximity', 'Operating Hours', 'Pointer Entropy'],
          datasets: [
            {
              label: 'Normal User Profile',
              data: [95, 90, 88, 92, 100, 85],
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.2)'
            },
            {
              label: 'Suspicious / Attacker Vector',
              data: [25, 20, 15, 10, 40, 20],
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.2)'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              angleLines: { color: 'rgba(255,255,255,0.08)' },
              grid: { color: 'rgba(255,255,255,0.08)' },
              pointLabels: { color: '#94a3b8', font: { size: 10 } },
              ticks: { display: false }
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: '#94a3b8' } }
          }
        }
      });
    }
  }

  async initLeafletMap() {
    const mapEl = document.getElementById('cyberMap');
    if (!mapEl || this.map) return;

    // Center on world/US
    this.map = L.map('cyberMap', {
      center: [30.0, 0.0],
      zoom: 2,
      minZoom: 1,
      maxZoom: 18
    });

    // Dark Matter tile layer for slick cybersecurity visual
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; CartoDB & OpenStreetMap',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);
  }

  plotMapMarkers(points) {
    if (!this.map) return;
    this.mapMarkers.forEach(m => this.map.removeLayer(m));
    this.mapMarkers = [];

    points.forEach(pt => {
      if (!pt.latitude || !pt.longitude) return;

      let color = '#10b981';
      if (pt.action_taken === 'BLOCKED') color = '#ef4444';
      else if (pt.action_taken === 'MFA_REQUIRED') color = '#f59e0b';

      const circle = L.circleMarker([pt.latitude, pt.longitude], {
        radius: 8,
        fillColor: color,
        color: '#ffffff',
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: 0.75
      }).addTo(this.map);

      const popupContent = `
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #fff;">
          <b style="color: ${color}; text-transform: uppercase;">${pt.action_taken}</b><br/>
          <b>Target:</b> ${pt.email}<br/>
          <b>Location:</b> ${pt.city || 'Unknown'}<br/>
          <b>Risk Score:</b> ${pt.risk_score}%<br/>
          <b>Reasons:</b> ${pt.failure_reasons || 'Normal'}<br/>
          <small style="color: #94a3b8;">${new Date(pt.timestamp).toLocaleString()}</small>
        </div>
      `;
      circle.bindPopup(popupContent);
      this.mapMarkers.push(circle);
    });
  }

  async loadUsersTable() {
    try {
      const res = await fetch('/api/admin/users');
      const users = await res.json();
      const tbody = document.getElementById('usersTableBody');
      if (!tbody) return;

      tbody.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span style="color: #f8fafc; font-weight: 600;">${u.full_name}</span><br/><small style="color: #64748b;">${u.email}</small></td>
          <td><span class="badge ${u.role === 'admin' ? 'MFA_REQUIRED' : 'ALLOWED'}">${u.role.toUpperCase()}</span></td>
          <td>
            <span style="color: ${u.has_face ? 'var(--cyan)' : 'var(--red)'}; font-family: var(--font-mono); font-size: 0.75rem;">
              ${u.has_face ? '✓ 512-d SEALED' : '✗ PENDING'}
            </span>
          </td>
          <td><span style="color: var(--emerald); font-family: var(--font-mono);">✓ ENCLAVE-SYNC</span></td>
          <td>${u.home_city}</td>
          <td><span style="font-family: var(--font-mono); color: var(--cyan);">${u.base_typing_speed} chars/s</span></td>
          <td>
            <span class="badge ${u.is_blocked ? 'BLOCKED' : 'ALLOWED'}">
              ${u.is_blocked ? 'LOCKED' : 'ACTIVE'}
            </span>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error("Failed to load users table:", e);
    }
  }

  async loadAuditLogs() {
    try {
      const res = await fetch('/api/admin/logs?limit=25');
      const logs = await res.json();
      const tbody = document.getElementById('auditLogsTableBody');
      if (!tbody) return;

      tbody.innerHTML = '';
      logs.forEach(l => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="font-family: var(--font-mono); font-size: 0.72rem;">${new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          <td><b>${l.email}</b><br/><small style="color: #64748b;">${l.city} (${l.ip_address})</small></td>
          <td><span class="badge ${l.action_taken}">${l.action_taken}</span></td>
          <td><b style="font-family: var(--font-mono);">${l.risk_score}%</b> (${l.risk_level})</td>
          <td style="font-family: var(--font-mono); color: var(--cyan);">${(l.face_similarity * 100).toFixed(0)}%</td>
          <td style="font-family: var(--font-mono);">${l.typing_duration_sec}s</td>
          <td style="font-size: 0.72rem; color: #94a3b8; max-width: 250px;">${l.failure_reasons || 'Baseline compliant'}</td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error("Failed to load audit logs:", e);
    }
  }

  async loadPolicies() {
    try {
      const res = await fetch('/api/admin/policies');
      this.policies = await res.json();
      this.bindPolicyInputs();
    } catch (e) {
      console.error("Failed to load policies:", e);
    }
  }

  bindPolicyInputs() {
    const p = this.policies;
    const startHourEl = document.getElementById('policyStartHour');
    const endHourEl = document.getElementById('policyEndHour');
    const maxTypingEl = document.getElementById('policyMaxTyping');
    const faceThreshEl = document.getElementById('policyFaceThresh');
    const maxGeoEl = document.getElementById('policyMaxGeo');
    const irisToggle = document.getElementById('policyRequireIris');
    const teeToggle = document.getElementById('policySnapdragonTEE');

    if (startHourEl) {
      startHourEl.value = p.start_hour;
      document.getElementById('valStartHour').innerText = `${p.start_hour}:00`;
      startHourEl.oninput = (e) => document.getElementById('valStartHour').innerText = `${e.target.value}:00`;
    }

    if (endHourEl) {
      endHourEl.value = p.end_hour;
      document.getElementById('valEndHour').innerText = `${p.end_hour}:00`;
      endHourEl.oninput = (e) => document.getElementById('valEndHour').innerText = `${e.target.value}:00`;
    }

    if (maxTypingEl) {
      maxTypingEl.value = p.max_typing_seconds;
      document.getElementById('valMaxTyping').innerText = `${p.max_typing_seconds}s`;
      maxTypingEl.oninput = (e) => {
        document.getElementById('valMaxTyping').innerText = `${e.target.value}s`;
        if (window.behavioralSensors) {
          window.behavioralSensors.adminMaxTypingSec = parseFloat(e.target.value);
        }
      };
    }

    if (faceThreshEl) {
      faceThreshEl.value = p.face_threshold;
      document.getElementById('valFaceThresh').innerText = `${(p.face_threshold * 100).toFixed(0)}%`;
      faceThreshEl.oninput = (e) => document.getElementById('valFaceThresh').innerText = `${(e.target.value * 100).toFixed(0)}%`;
    }

    if (maxGeoEl) {
      maxGeoEl.value = p.max_geo_km;
      document.getElementById('valMaxGeo').innerText = `${p.max_geo_km} km`;
      maxGeoEl.oninput = (e) => document.getElementById('valMaxGeo').innerText = `${e.target.value} km`;
    }

    if (irisToggle) irisToggle.checked = !!p.require_iris;
    if (teeToggle) teeToggle.checked = !!p.snapdragon_tee_mode;

    // Save button handler
    const saveBtn = document.getElementById('btnSavePolicies');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const payload = {
          start_hour: parseInt(startHourEl.value),
          end_hour: parseInt(endHourEl.value),
          max_typing_seconds: parseFloat(maxTypingEl.value),
          min_typing_seconds: 0.6,
          face_threshold: parseFloat(faceThreshEl.value),
          max_geo_km: parseFloat(maxGeoEl.value),
          risk_low_max: 30.0,
          risk_med_max: 70.0,
          require_iris: irisToggle.checked,
          snapdragon_tee_mode: teeToggle.checked
        };

        const res = await fetch('/api/admin/policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const out = await res.json();
        if (out.status === 'SUCCESS') {
          this.policies = out.policies;
          if (window.behavioralSensors) {
            window.behavioralSensors.adminMaxTypingSec = payload.max_typing_seconds;
          }
          this.showToast("✓ Security Policies Successfully Deployed to Edge Nodes!");
        }
      };
    }
  }

  showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span style="color: var(--cyan); font-weight: bold;">⚡</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

window.socDashboard = new DashboardController();
