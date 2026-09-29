// ============================================================
//  SentinelAI – Client Session Store
//  Persists the authenticated session (token + user) in
//  localStorage so the separate HTML pages (signin / dashboard /
//  admin) share one login state, and provides logout handling.
// ============================================================

export interface SessionUser {
  email: string;
  full_name: string;
  role: string;
  home_city?: string;
}

export interface ClientSession {
  token: string;
  session_id?: number;
  user: SessionUser;
  login_time: string;
}

const KEY = 'sentinel_session';

export function saveSession(s: ClientSession): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function getSession(): ClientSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ClientSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

export function isAuthenticated(): boolean {
  return !!getSession()?.token;
}

export function isAdmin(): boolean {
  return getSession()?.user?.role === 'admin';
}

/** Redirect to the sign-in page if there is no active session. */
export function requireAuth(): ClientSession | null {
  const s = getSession();
  if (!s?.token) {
    window.location.href = '/signin.html';
    return null;
  }
  return s;
}

/** Require an authenticated admin, otherwise bounce to sign-in/dashboard. */
export function requireAdmin(): ClientSession | null {
  const s = requireAuth();
  if (s && s.user?.role !== 'admin') {
    window.location.href = '/dashboard.html';
    return null;
  }
  return s;
}

/**
 * Close the session on the backend (records logout_time), clear local
 * state and return to the sign-in page.
 */
export async function logout(redirect = true): Promise<void> {
  const s = getSession();
  if (s?.token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: s.token })
      });
    } catch { /* best effort */ }
  }
  clearSession();
  if (redirect) window.location.href = '/signin.html';
}
