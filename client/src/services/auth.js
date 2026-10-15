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

export const authApi = {
  me: () => request('GET', '/auth/me'),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  signup: (email, password) => request('POST', '/auth/signup', { email, password }),
  logout: () => request('POST', '/auth/logout'),
  changePassword: (currentPassword, newPassword) => request('POST', '/auth/password', { currentPassword, newPassword })
};

export const adminApi = {
  stats: (days = 7) => request('GET', `/admin/stats?days=${days}`),
  users: () => request('GET', '/admin/users'),
  createUser: (user) => request('POST', '/admin/users', user),
  updateUser: (id, changes) => request('PATCH', `/admin/users/${id}`, changes),
  deleteUser: (id) => request('DELETE', `/admin/users/${id}`)
};
