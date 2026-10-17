import { useCallback, useEffect, useRef, useState } from 'react';
import { convertToPdfStream, extractConversation } from '../services/api';

const HISTORY_LIMIT = 8;
let nextId = 1;

/**
 * Drives one conversion at a time:
 *   idle → running → success | error
 *
 * PDF conversions use the streaming endpoint, so `state.stages` records the
 * real server-side steps (with the time each one started). Finished PDF
 * conversions are kept in a per-tab history (memory only) for re-download,
 * preview or retry; their object URLs are revoked when they leave it.
 */
export function useConversion() {
  const [state, setState] = useState({ status: 'idle' });
  const [history, setHistory] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const controllerRef = useRef(null);
  const lastRequestRef = useRef(null);
  const historyRef = useRef(history);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    if (state.status !== 'running') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.status]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    for (const entry of historyRef.current) if (entry.result?.previewUrl) URL.revokeObjectURL(entry.result.previewUrl);
  }, []);

  const elapsed = state.status === 'running' ? Math.max(0, (now - state.startedAt) / 1000) : 0;

  const addToHistory = useCallback((entry) => {
    setHistory((prev) => {
      const next = [entry, ...prev];
      for (const old of next.slice(HISTORY_LIMIT)) {
        if (old.result?.previewUrl) URL.revokeObjectURL(old.result.previewUrl);
      }
      return next.slice(0, HISTORY_LIMIT);
    });
  }, []);

  const run = useCallback(async ({ mode, url, platform, options, autoDownload = false }) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    lastRequestRef.current = { mode, url, platform, options };

    const id = nextId++;
    const startedAt = Date.now();
    setNow(startedAt);
    setState({ status: 'running', id, mode, url, platform, options, startedAt, stages: [] });

    const onStage = (stage, info) => {
      setState((prev) => (prev.id === id && prev.status === 'running'
        ? { ...prev, stages: [...prev.stages, { stage, info, at: Date.now(), serverAt: info?.at }] }
        : prev));
    };

    const result = mode === 'inspect'
      ? await extractConversation(url, platform, controller.signal)
      : await convertToPdfStream(url, platform, { signal: controller.signal, onStage, options });

    if (controllerRef.current !== controller) {
      if (result.previewUrl) URL.revokeObjectURL(result.previewUrl); // superseded
      return;
    }
    controllerRef.current = null;

    const finishedAt = Date.now();
    const finished = result.ok
      ? { status: 'success', id, mode, url, platform, options, result, durationMs: finishedAt - startedAt, autoDownload }
      : { status: 'error', id, mode, url, platform, options, error: result.error };
    setState(finished);

    // A cancelled or refused (daily limit reached) attempt is not a conversion worth listing
    if (mode === 'pdf' && !['CANCELLED', 'QUOTA_EXCEEDED'].includes(result.error?.code)) {
      addToHistory({ ...finished, autoDownload: false, at: finishedAt });
    }
  }, [addToHistory]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const retry = useCallback(() => {
    if (lastRequestRef.current) run(lastRequestRef.current);
  }, [run]);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: 'idle' });
  }, []);

  /** Shows a history entry as the current result. */
  const show = useCallback((entry) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    lastRequestRef.current = { mode: entry.mode, url: entry.url, platform: entry.platform, options: entry.options };
    setState({ ...entry, fromHistory: true });
  }, []);

  const clearHistory = useCallback(() => {
    for (const entry of historyRef.current) if (entry.result?.previewUrl) URL.revokeObjectURL(entry.result.previewUrl);
    setHistory([]);
    setState((prev) => (prev.status === 'success' && prev.mode === 'pdf' ? { status: 'idle' } : prev));
  }, []);

  return { state, elapsed, history, convert: run, cancel, retry, reset, show, clearHistory };
}
