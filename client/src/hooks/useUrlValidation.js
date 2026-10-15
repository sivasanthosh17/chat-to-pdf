import { useEffect, useState } from 'react';
import { validateUrl } from '../services/api';

/**
 * Debounced, cancellable server-side validation of the pasted URL
 * (the backend applies the HTTPS / host allowlist / DNS checks).
 *
 * Results are stored per URL; whether the current URL is still "checking"
 * is derived during render.
 */
export function useUrlValidation(url, delayMs = 400) {
  const trimmed = url.trim();
  const [result, setResult] = useState({ url: '', status: 'empty' });

  useEffect(() => {
    if (!trimmed) return undefined;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await validateUrl(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setResult(response.ok
        ? { url: trimmed, status: 'valid', data: response.data }
        : { url: trimmed, status: 'invalid', error: response.error });
    }, delayMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, delayMs]);

  if (!trimmed) return { status: 'empty' };
  if (result.url !== trimmed) return { status: 'checking' };
  return result;
}
