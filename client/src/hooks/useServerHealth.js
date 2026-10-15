import { useState, useEffect, useCallback } from 'react';
import { checkServerHealth } from '../services/api';

/**
 * Tracks whether the backend is reachable.
 * status: 'checking' | 'connected' | 'error'
 */
export function useServerHealth() {
  const [state, setState] = useState({ status: 'checking', data: null, latency: null, error: null });

  const apply = useCallback((result) => {
    setState(result.ok
      ? { status: 'connected', data: result.data, latency: result.latencyMs, error: null }
      : { status: 'error', data: null, latency: result.latencyMs, error: result.error });
  }, []);

  useEffect(() => {
    let active = true;
    checkServerHealth().then((result) => {
      if (active) apply(result);
    });
    return () => {
      active = false;
    };
  }, [apply]);

  const recheck = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'checking' }));
    apply(await checkServerHealth());
  }, [apply]);

  return { ...state, recheck, isChecking: state.status === 'checking' };
}
