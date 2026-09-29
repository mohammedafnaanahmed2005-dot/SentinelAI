// ============================================================
//  SentinelAI – Dashboard Page Entry Point (shared, no map)
//  Auth-guarded. Renders stats, session register, users, audit
//  logs, policies and the Snapdragon SPU visualizer.
// ============================================================

import './style.css';
import { DashboardController }  from './dashboard.ts';
import { SnapdragonVisualizer } from './snapdragonSec.ts';
import { requireAuth, getSession, logout } from './session.ts';

const dashboard = new DashboardController();
const snapSec   = new SnapdragonVisualizer();

(window as any).sentinel      = { dashboard };
(window as any).snapdragonSec = snapSec;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAuth();
  if (!session) return; // redirected to /signin.html

  // Header identity chip + admin-only controls
  const chip = document.getElementById('userChip');
  if (chip) chip.innerText = `${session.user.full_name} · ${session.user.role.toUpperCase()}`;
  if (session.user.role === 'admin') {
    document.getElementById('navAdminWrap')?.classList.remove('hidden');
  }

  snapSec.init();
  await dashboard.loadStats();
  await dashboard.loadSessions();
  await dashboard.loadUsers();
  await dashboard.loadLogs();
  (window as any).switchView('dashboard');
});

/* ─── View navigation ───────────────────────────────────── */
(window as any).switchView = async (view: string): Promise<void> => {
  const views = ['dashboard', 'users', 'policy', 'snapdragon'];
  views.forEach(v => {
    document.getElementById(`view-${v}`)?.classList.toggle('hidden', v !== view);
  });
  const navMap: Record<string, string> = {
    dashboard: 'navDashboard', users: 'navUsers',
    policy: 'navPolicy', snapdragon: 'navSnapdragon'
  };
  Object.entries(navMap).forEach(([v, id]) => {
    document.getElementById(id)?.classList.toggle('active-nav', v === view);
  });

  if (view === 'dashboard') { await dashboard.loadStats(); await dashboard.loadSessions(); await dashboard.loadLogs(); }
  if (view === 'users')     { await dashboard.loadUsers(); }
  if (view === 'policy')    { await dashboard.loadPolicies(); }
};

(window as any).goAdmin  = (): void => { window.location.href = '/admin.html'; };
(window as any).doLogout = async (): Promise<void> => { await logout(true); };
(window as any).deleteUser = (email: string): void => { void dashboard.deleteUser(email); };

export function currentUser() { return getSession()?.user ?? null; }
