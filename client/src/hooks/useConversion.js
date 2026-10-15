import { useCallback, useEffect, useRef, useState } from 'react';
import { convertToPdf, extractConversation } from '../services/api';

/**
 * Drives one conversion at a time:
 *   idle → running → success | error
 * with an elapsed-time counter, cancellation and retry of the last request.
 *
 * Progress is reported honestly: the server does retrieval, verification and
 * rendering in one request, so the UI shows elapsed time rather than a fake
 * percentage.
 */
export function useConversion() {
  const [state, setState] = useState({ status: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const controllerRef = useRef(null);
  const lastRequestRef = useRef(null);

  useEffect(() => {
    if (state.status !== 'running') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [state.status]);

  const elapsed = state.status === 'running' ? Math.max(0, Math.floor((now - state.startedAt) / 1000)) : 0;

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(async ({ mode, url, platform }) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    lastRequestRef.current = { mode, url, platform };

    const startedAt = Date.now();
    setNow(startedAt);
    setState({ status: 'running', mode, url, platform, startedAt });

    const result = mode === 'inspect'
      ? await extractConversation(url, platform, controller.signal)
      : await convertToPdf(url, platform, controller.signal);

    if (controllerRef.current !== controller) return; // superseded by a newer request
    controllerRef.current = null;

    setState(result.ok
      ? { status: 'success', mode, url, platform, result }
      : { status: 'error', mode, url, platform, error: result.error });
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    if (lastRequestRef.current) run(lastRequestRef.current);
  }, [run]);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: 'idle' });
  }, []);

  return { state, elapsed, convert: run, cancel, retry, reset };
}
