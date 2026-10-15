import { useCallback, useEffect, useState } from 'react';
import { authApi } from '../services/auth';

/**
 * Current user and session actions.
 * status: 'loading' | 'anonymous' | 'authenticated' | 'offline'
 */
export function useAuth() {
  const [state, setState] = useState({ status: 'loading', user: null, signupAllowed: true });

  const apply = useCallback((result) => {
    if (!result.ok) {
      setState((prev) => ({ ...prev, status: result.error.code === 'NETWORK' ? 'offline' : 'anonymous', user: null }));
      return;
    }
    setState({
      status: result.data.user ? 'authenticated' : 'anonymous',
      user: result.data.user,
      signupAllowed: result.data.signupAllowed !== false
    });
  }, []);

  const refresh = useCallback(async () => apply(await authApi.me()), [apply]);

  useEffect(() => {
    let active = true;
    authApi.me().then((result) => {
      if (active) apply(result);
    });
    return () => {
      active = false;
    };
  }, [apply]);

  const login = useCallback(async (email, password) => {
    const result = await authApi.login(email, password);
    if (result.ok) setState((prev) => ({ ...prev, status: 'authenticated', user: result.data.user }));
    return result;
  }, []);

  const signup = useCallback(async (email, password) => {
    const result = await authApi.signup(email, password);
    if (result.ok) setState((prev) => ({ ...prev, status: 'authenticated', user: result.data.user }));
    return result;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setState((prev) => ({ ...prev, status: 'anonymous', user: null }));
  }, []);

  return { ...state, refresh, login, signup, logout };
}
