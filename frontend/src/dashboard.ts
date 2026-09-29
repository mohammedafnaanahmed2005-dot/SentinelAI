// ============================================================
//  SentinelAI – SOC Dashboard & Admin Policy Controller (TS)
// ============================================================

import type {
  DashboardStats, AuditLog, UserRecord, SecurityPolicy
} from './types.ts';
import { getSession } from './session.ts';

declare const Chart: any;

/** A row from the login/logout session register (kept local to avoid a hard types.ts dependency). */
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

export class DashboardController {
  private charts: Record<string, any> = {};
  private policies: SecurityPolicy | null = null;

  async init(): Promise<void> {
    await this.loadStats();
    await this.loadSessions();
    await this.loadUsers();
    await this.loadLogs();
    await this.loadPolicies();
  }

  /* ─── Stats & Charts ───────────────────────────────────── */
  async loadStats(): Promise<void> {
    try {
      const res  = await fetch('/api/admin/stats');
      const data = await res.json() as DashboardStats;

      this.setText('statTotalAttempts',  String(data.total_attempts));
      this.setText('statBlockedAttacks', String(data.blocked_attacks));
      this.setText('statMfaChallenges',  String(data.mfa_challenges));
      this.setText('statAvgRiskScore',   `${data.avg_risk_score}%`);

      this.renderCharts(data);
    } catch (e) {
      console.error('Stats fetch failed:', e);
    }
  }

  private renderCharts(stats: DashboardStats): void {
    // 1. Risk Breakdown Doughnut
    const el1 = document.getElementById('riskBreakdownChart') as HTMLCanvasElement;
    if (el1) {
      this.charts.breakdown?.destroy();
      const bd = stats.risk_breakdown ?? { LOW: 4, MEDIUM: 2, HIGH: 3 };
      this.charts.breakdown = new Chart(el1, {
        type: 'doughnut',
        data: {
          labels: ['Low Risk (Allowed)', 'Medium Risk (MFA)', 'High Risk (Blocked)'],
          datasets: [{ data: [bd.LOW ?? 0, bd.MEDIUM ?? 0, bd.HIGH ?? 0],
            backgroundColor: ['#10b981','#f59e0b','#ef4444'],
            borderColor: '#060913', borderWidth: 3 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '72%',
          plugins: { legend: { position:'bottom', labels:{ color:'#94a3b8', font:{ family:'Inter', size:11 } } } }
        }
      });
    }

    // 2. Threat Velocity Line
    const el2 = document.getElementById('threatVelocityChart') as HTMLCanvasElement;
    if (el2) {
      this.charts.velocity?.destroy();
      this.charts.velocity = new Chart(el2, {
        type: 'line',
        data: {
          labels: ['00:00','03:00','06:00','08:00','10:00','12:00','14:00','16:00','18:00','21:00'],
          datasets: [
            { label:'Authorized Logins',   data:[1,0,2,8,14,11,15,12,6,2],
              borderColor:'#00f2fe', backgroundColor:'rgba(0,242,254,0.07)', fill:true, tension:0.35 },
            { label:'Blocked Intrusions',  data:[3,4,1,0,2,1,0,1,2,5],
              borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.07)',  fill:true, tension:0.35 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position:'top', labels:{ color:'#94a3b8', font:{ size:11 } } } },
          scales: {
            x: { grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#64748b' } },
            y: { grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#64748b' } }
          }
        }
      });
    }

    // 3. Multi-Vector Radar
    const el3 = document.getElementById('vectorRadarChart') as HTMLCanvasElement;
    if (el3) {
      this.charts.radar?.destroy();
      this.charts.radar = new Chart(el3, {
        type: 'radar',
        data: {
          labels: ['Facial Match','Iris Liveness','Keystroke Duration','Geo Proximity','Operating Hours','Pointer Entropy'],
          datasets: [
            { label:'Authorized Profile', data:[95,90,88,92,100,85],
              borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.18)' },
            { label:'Attacker Pattern',   data:[25,20,15,10,40,20],
              borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.18)' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { r: { angleLines:{ color:'rgba(255,255,255,0.07)' }, grid:{ color:'rgba(255,255,255,0.07)' },
            pointLabels:{ color:'#94a3b8', font:{ size:10 } }, ticks:{ display:false } } },
          plugins: { legend:{ position:'bottom', labels:{ color:'#94a3b8' } } }
        }
      });
    }
  }

  /* ─── Login / Logout Session Register ──────────────────── */
  async loadSessions(): Promise<void> {
    try {
      const res  = await fetch('/api/sessions?limit=100');
      const rows = await res.json() as SessionRecord[];
      const tbody = document.getElementById('sessionsTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-slate-600 py-4">No sessions recorded yet.</td></tr>`;
        return;
      }
      rows.forEach(s => {
        const tr = document.createElement('tr');
        const login  = s.login_time  ? new Date(s.login_time).toLocaleString()  : '–';
        const logout = s.logout_time ? new Date(s.logout_time).toLocaleString() : '<span class="text-emerald-400">● ACTIVE</span>';
        const pct    = Math.round((s.face_similarity ?? 0) * 100);
        const face   = s.face_verified
          ? `<span class="text-emerald-400">✓ ${pct}%</span>`
          : `<span class="text-red-400">✗ ${pct}%</span>`;
        const status = s.status === 'ACTIVE'
          ? '<span class="badge badge-allowed">ACTIVE</span>'
          : '<span class="badge badge-mfa">CLOSED</span>';
        tr.innerHTML = `
          <td class="font-semibold text-slate-100">${s.user_name ?? '–'}</td>
          <td class="font-mono text-[11px]">${s.email}</td>
          <td class="text-slate-400">${s.location ?? '–'}</td>
          <td class="font-mono text-[11px]">${login}</td>
          <td class="font-mono text-[11px]">${logout}</td>
          <td class="font-mono text-[11px]">${face}</td>
          <td>${status}</td>`;
        tbody.appendChild(tr);
      });
    } catch (e) { console.error('Sessions load failed:', e); }
  }

  /* ─── Users Table ──────────────────────────────────────── */
  async loadUsers(): Promise<void> {
    try {
      const res   = await fetch('/api/admin/users');
      const users = await res.json() as UserRecord[];
      const tbody = document.getElementById('usersTableBody');
      if (!tbody) return;
      const count = document.getElementById('usersTableCount');
      if (count) count.innerText = `${users.length} RECORD${users.length === 1 ? '' : 'S'}`;
      const isAdmin = getSession()?.user.role === 'admin';
      tbody.innerHTML = '';
      if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-slate-600 py-4">User registry is empty - register users from the admin page.</td></tr>`;
        return;
      }
      users.forEach(u => {
        const tr = document.createElement('tr');
        const enrolled = u.enrolled_at ? new Date(u.enrolled_at).toLocaleString() : '–';
        const canDelete = isAdmin && u.role !== 'admin';
        const safeEmail = u.email.replace(/'/g, "\\'");
        tr.innerHTML = `
          <td class="font-mono text-[11px] text-slate-500">${u.id}</td>
          <td><span class="font-semibold text-slate-100">${u.full_name}</span><br/><small class="text-slate-500 font-mono text-[10px]">${u.email}</small></td>
          <td><span class="badge ${u.role==='admin' ? 'badge-mfa' : 'badge-allowed'}">${u.role.toUpperCase()}</span></td>
          <td class="font-mono text-[11px] text-slate-400">${enrolled}</td>
          <td><span class="font-mono text-xs ${u.has_face ? 'text-cyan-400' : 'text-red-400'}">${u.has_face ? '✓ 128-d SEALED' : '✗ NO TEMPLATE'}</span></td>
          <td><span class="font-mono text-xs ${u.iris_verified ? 'text-emerald-400' : 'text-slate-500'}">${u.iris_verified ? '✓ ENCLAVE-SYNC' : '✗ UNVERIFIED'}</span></td>
          <td class="text-slate-400">${u.home_city}<br/><small class="text-slate-600 font-mono text-[10px]">${u.home_lat.toFixed(3)}, ${u.home_lng.toFixed(3)}</small></td>
          <td><span class="font-mono text-xs text-cyan-400">${u.base_typing_speed} c/s</span></td>
          <td><span class="badge ${u.is_blocked ? 'badge-blocked' : 'badge-allowed'}">${u.is_blocked ? 'LOCKED' : 'ACTIVE'}</span></td>
          <td>${canDelete
            ? `<button data-delete-email="${u.email.replace(/"/g, '&quot;')}" class="px-2.5 py-1 rounded bg-red-500/10 border border-red-500/30 font-mono text-[10px] text-red-400 hover:bg-red-500/25 transition-all" title="Delete user and related records">🗑 DELETE</button>`
            : '<span class="font-mono text-[10px] text-slate-600">PROTECTED</span>'}</td>
        `;
        // Attach delete handler safely via event listener (avoids onclick injection issues)
        const btn = tr.querySelector<HTMLButtonElement>('button[data-delete-email]');
        if (btn) {
          btn.addEventListener('click', () => { void this.deleteUser(u.email); });
        }
        tbody.appendChild(tr);
      });
    } catch (e) { console.error('Users load failed:', e); }
  }

  /** Delete a user from the registry (admin only, enforced by the backend). */
  async deleteUser(email: string): Promise<void> {
    if (!confirm(`Delete ${email} from the user database?\nTheir OTP tokens and session records will also be removed.`)) return;
    try {
      // Use query parameter instead of path segment to avoid proxy mangling %40 (@)
      const res = await fetch(`/api/admin/users?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
      const out = await res.json();
      if (res.ok && out.status === 'SUCCESS') {
        this.showToast(`🗑 ${email} deleted from the registry.`);
        await this.loadUsers();
      } else {
        this.showToast(out.detail ?? 'Delete failed.', 'error');
      }
    } catch {
      this.showToast('Network error - backend unreachable.', 'error');
    }
  }

  /* ─── Audit Logs ───────────────────────────────────────── */
  async loadLogs(): Promise<void> {
    try {
      const res  = await fetch('/api/admin/logs?limit=20');
      const logs = await res.json() as AuditLog[];
      const tbody = document.getElementById('auditLogsTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';
      logs.forEach(l => {
        const tr = document.createElement('tr');
        const cls = l.action_taken === 'ALLOWED' ? 'badge-allowed'
                  : l.action_taken === 'BLOCKED'  ? 'badge-blocked' : 'badge-mfa';
        tr.innerHTML = `
          <td class="font-mono text-[11px]">${new Date(l.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}</td>
          <td><b>${l.email}</b><br/><small class="text-slate-500 font-mono text-[10px]">${l.city} · ${l.ip_address}</small></td>
          <td><span class="badge ${cls}">${l.action_taken}</span></td>
          <td class="font-mono font-bold">${l.risk_score}% <span class="text-slate-500 font-normal">(${l.risk_level})</span></td>
          <td class="font-mono text-cyan-400">${(l.face_similarity * 100).toFixed(0)}%</td>
          <td class="font-mono">${l.typing_duration_sec}s</td>
          <td class="text-[11px] max-w-[220px] truncate text-slate-400">${l.failure_reasons || '–'}</td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) { console.error('Logs load failed:', e); }
  }

  /* ─── Policies ─────────────────────────────────────────── */
  async loadPolicies(): Promise<void> {
    try {
      const res = await fetch('/api/admin/policies');
      this.policies = await res.json() as SecurityPolicy;
      this.bindPolicyUI();
    } catch (e) { console.error('Policies load failed:', e); }
  }

  private bindPolicyUI(): void {
    const p = this.policies!;
    const bind = (id: string, valId: string, fmt: (v: string) => string): void => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      const vl = document.getElementById(valId);
      if (!el || !vl) return;
      el.value = String((p as any)[id.replace('policy', '').replace(/([A-Z])/g, '_$1').slice(1).toLowerCase()] ?? el.value);
      vl.innerText = fmt(el.value);
      el.addEventListener('input', () => { vl.innerText = fmt(el.value); });
    };

    // Map slider IDs to policy fields manually for clarity
    const sh = document.getElementById('policyStartHour') as HTMLInputElement;
    const sv = document.getElementById('valStartHour');
    if (sh && sv) { sh.value = String(p.start_hour); sv.innerText = `${p.start_hour}:00`; sh.oninput = () => { sv.innerText = `${sh.value}:00`; }; }

    const eh = document.getElementById('policyEndHour') as HTMLInputElement;
    const ev = document.getElementById('valEndHour');
    if (eh && ev) { eh.value = String(p.end_hour); ev.innerText = `${p.end_hour}:00`; eh.oninput = () => { ev.innerText = `${eh.value}:00`; }; }

    const mt = document.getElementById('policyMaxTyping') as HTMLInputElement;
    const mv = document.getElementById('valMaxTyping');
    if (mt && mv) {
      mt.value = String(p.max_typing_seconds); mv.innerText = `${p.max_typing_seconds}s`;
      mt.oninput = () => { mv.innerText = `${mt.value}s`; (window as any).sentinel?.sensors?.adminMaxTyping && ((window as any).sentinel.sensors.adminMaxTyping = +mt.value); };
    }

    const ft = document.getElementById('policyFaceThresh') as HTMLInputElement;
    const fv = document.getElementById('valFaceThresh');
    if (ft && fv) { ft.value = String(p.face_threshold); fv.innerText = `${Math.round(p.face_threshold * 100)}%`; ft.oninput = () => { fv.innerText = `${Math.round(+ft.value * 100)}%`; }; }

    const gm = document.getElementById('policyMaxGeo') as HTMLInputElement;
    const gv = document.getElementById('valMaxGeo');
    if (gm && gv) { gm.value = String(p.max_geo_km); gv.innerText = `${p.max_geo_km} km`; gm.oninput = () => { gv.innerText = `${gm.value} km`; }; }

    const iris = document.getElementById('policyRequireIris') as HTMLInputElement;
    const tee  = document.getElementById('policySnapdragonTEE') as HTMLInputElement;
    if (iris) iris.checked = !!p.require_iris;
    if (tee)  tee.checked  = !!p.snapdragon_tee_mode;

    const saveBtn = document.getElementById('btnSavePolicies');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const payload = {
          start_hour:            +(sh?.value ?? 8),
          end_hour:              +(eh?.value ?? 20),
          max_typing_seconds:    +(mt?.value ?? 7.5),
          min_typing_seconds:    0.6,
          face_threshold:        +(ft?.value ?? 0.55),
          max_geo_km:            +(gm?.value ?? 60),
          risk_low_max:          30.0,
          risk_med_max:          70.0,
          require_iris:          iris?.checked ?? true,
          snapdragon_tee_mode:   tee?.checked  ?? true
        };
        const r = await fetch('/api/admin/policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const out = await r.json();
        if (out.status === 'SUCCESS') {
          this.policies = out.policies;
          this.showToast('⚡ Security policies deployed to all edge nodes.');
        }
      };
    }
  }

  /* ─── Helpers ──────────────────────────────────────────── */
  showToast(msg: string, type: 'success' | 'warning' | 'error' = 'success'): void {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const colors: Record<string, string> = { success: 'text-cyan-400', warning: 'text-amber-400', error: 'text-red-400' };
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="font-bold ${colors[type]}">⚡</span> ${msg}`;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
  }

  private setText(id: string, val: string): void {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  }
}
