/**
 * Account and admin API calls. Every function resolves (never rejects) to
 * { ok: true, data } or { ok: false, error: { code, message } }.
 * The session lives in an HttpOnly cookie the browser sends automatically.
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') + '/api';

async function request(method, path, body) {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.success) {
      return {
        ok: false,
        error: {
          code: json?.error?.code || 'INTERNAL',
          message: json?.error?.message || `Request failed (HTTP ${response.status}).`
        }
      };
    }
    return { ok: true, data: json.data };
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'Could not reach the server.' } };
  }
}

/**
 * Saves a file the server sends as an attachment (CSV exports). Fetched with
 * the session cookie, so an ended session shows an error message instead of
 * opening a JSON error page.
 */
async function downloadFile(path, fallbackName) {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
    if (!response.ok) {
      const json = await response.json().catch(() => null);
      return {
        ok: false,
        error: { code: json?.error?.code || 'INTERNAL', message: json?.error?.message || `Download failed (HTTP ${response.status}).` }
      };
    }
    const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    // Removing the link in the same tick can lose the file name (see download.js)
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
    return { ok: true, data: { name } };
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'Could not reach the server.' } };
  }
}

export const authApi = {
  me: () => request('GET', '/auth/me'),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  signup: (email, password) => request('POST', '/auth/signup', { email, password }),
  logout: () => request('POST', '/auth/logout'),
  changePassword: (currentPassword, newPassword) => request('POST', '/auth/password', { currentPassword, newPassword })
};

export const adminApi = {
  stats: (days = 7) => request('GET', `/admin/stats?days=${days}`),
  users: (days = 7) => request('GET', `/admin/users?days=${days}`),
  userActivity: (id, days = 30) => request('GET', `/admin/users/${id}/activity?days=${days}`),
  failures: (days = 7) => request('GET', `/admin/failures?days=${days}`),
  createUser: (user) => request('POST', '/admin/users', user),
  updateUser: (id, changes) => request('PATCH', `/admin/users/${id}`, changes),
  deleteUser: (id) => request('DELETE', `/admin/users/${id}`),
  health: () => request('GET', '/admin/health'),
  saveHealthLinks: (links) => request('PUT', '/admin/health/links', links),
  runHealthCheck: () => request('POST', '/admin/health/run'),
  exportUsage: (days = 30) => downloadFile(`/admin/export/usage.csv?days=${days}`, `chatpdf-usage-last-${days}-days.csv`),
  exportAccounts: (days = 30) => downloadFile(`/admin/export/users.csv?days=${days}`, 'chatpdf-accounts.csv')
};
