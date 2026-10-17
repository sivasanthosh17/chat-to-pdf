import React, { useEffect, useRef, useState } from 'react';
import { Hero } from '../components/Hero';
import { ConverterForm } from '../components/ConverterForm';
import { ConversionProgress } from '../components/ConversionProgress';
import { ResultPanel } from '../components/ResultPanel';
import { ErrorPanel } from '../components/ErrorPanel';
import { ConversationViewer } from '../components/ConversationViewer';
import { RecentConversions } from '../components/RecentConversions';
import { Icon } from '../components/Icon';
import { HowItWorks, PlatformSupport, Limitations } from '../components/InfoSections';
import { useConversion } from '../hooks/useConversion';
import { downloadResult } from '../services/download';
import { loadDownloadPrefs } from '../services/preferences';
import { localTime } from '../services/outcomes';

/** "27 of 30 PDFs left today" for accounts with a daily limit (nothing for unlimited ones). */
function QuotaNote({ quota }) {
  if (!quota || quota.unlimited) return null;
  const out = quota.remaining <= 0;
  return (
    <p className={`guest-note quota-note ${out ? 'is-out' : ''}`} role="status">
      <Icon name="clock" size={14} />
      {out
        ? `You have made today's ${quota.limit} PDF${quota.limit === 1 ? '' : 's'}. Previews still work; new PDFs from ${localTime(quota.resetsAt)}.`
        : `${quota.remaining} of ${quota.limit} PDF${quota.limit === 1 ? '' : 's'} left today · resets at ${localTime(quota.resetsAt)}`}
    </p>
  );
}

/**
 * The converter. Visitors can paste and check a link; Convert and Preview go
 * through `requireLogin`, which asks them to log in first and then continues.
 * App re-keys this component when the account changes, so the in-tab history
 * (and its PDFs) never carries over to another person.
 */
function Converter({ guest, quota, requireLogin, onSessionExpired, onQuotaChange }) {
  const { state, elapsed, history, convert, cancel, retry, reset, show, clearHistory } = useConversion();
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState('auto');
  const busy = state.status === 'running';

  // Bring the progress / outcome card into view when it appears
  useEffect(() => {
    const selector = state.status === 'running' ? '.progress-card' : state.status === 'idle' ? null : '.result-card, .error-card, .viewer';
    const el = selector && document.querySelector(selector);
    if (!el) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: state.status === 'running' ? 'nearest' : 'start' });
  }, [state.status, state.id]);

  // A PDF rebuilt from the download dialog is saved as soon as it is ready
  const autoDownloadedRef = useRef(null);
  useEffect(() => {
    if (state.status === 'success' && state.autoDownload && autoDownloadedRef.current !== state.id) {
      autoDownloadedRef.current = state.id;
      downloadResult(state.result);
    }
  }, [state]);

  // The session ended (expired, logged out elsewhere, account disabled):
  // ask to log in again, then retry what failed. Handled once per attempt.
  const handledExpiryRef = useRef(null);
  useEffect(() => {
    if (state.status !== 'error' || state.error?.code !== 'UNAUTHENTICATED') return;
    if (handledExpiryRef.current === state.id) return;
    handledExpiryRef.current = state.id;
    onSessionExpired(retry);
  }, [state, onSessionExpired, retry]);

  // A finished PDF attempt changes "PDFs left today": fetch the new count once
  const quotaSyncedRef = useRef(null);
  useEffect(() => {
    if ((state.status !== 'success' && state.status !== 'error') || state.mode !== 'pdf' || state.fromHistory) return;
    if (quotaSyncedRef.current === state.id) return;
    quotaSyncedRef.current = state.id;
    onQuotaChange();
  }, [state, onQuotaChange]);

  const rebuild = (options) =>
    convert({ mode: 'pdf', url: state.url, platform: state.platform, options, autoDownload: true });

  const fillLink = (item) => {
    setUrl(item.url);
    setPlatform(item.platform || 'auto');
    document.getElementById('share-url')?.focus();
  };

  return (
    <>
      <section className="card converter-card" aria-label="Convert a shared conversation">
        <ConverterForm
          url={url}
          onUrlChange={setUrl}
          platform={platform}
          onPlatformChange={setPlatform}
          busy={busy}
          onSubmit={(request) =>
            requireLogin(
              // The first PDF already follows the remembered download preference
              () => convert(request.mode === 'pdf' ? { ...request, options: loadDownloadPrefs() } : request),
              request.mode === 'pdf' ? 'to convert and download PDFs' : 'to preview conversations'
            )
          }
        />
        {guest ? (
          <p className="guest-note">
            <Icon name="lock" size={14} /> A free account is needed to convert or preview — you'll be asked when you click.
          </p>
        ) : (
          <QuotaNote quota={quota} />
        )}
      </section>

      {state.status === 'running' && (
        <ConversionProgress mode={state.mode} stages={state.stages} elapsed={elapsed} startedAt={state.startedAt} onCancel={cancel} />
      )}

      {state.status === 'error' && <ErrorPanel error={state.error} onRetry={retry} onReset={reset} />}

      {state.status === 'success' && state.mode === 'pdf' && (
        <ResultPanel
          key={state.id}
          result={state.result}
          durationMs={state.durationMs}
          fromHistory={state.fromHistory}
          onRebuild={rebuild}
          onReset={reset}
        />
      )}

      {state.status === 'success' && state.mode === 'inspect' && (
        <ConversationViewer conversation={state.result.conversation} verification={state.result.verification} onClose={reset} />
      )}

      <RecentConversions
        items={history}
        activeId={state.status === 'success' || state.status === 'error' ? state.id : null}
        onShow={show}
        onRetry={(item) => {
          fillLink(item);
          convert({ mode: 'pdf', url: item.url, platform: item.platform, options: loadDownloadPrefs() });
        }}
        onUseLink={fillLink}
        onClear={clearHistory}
      />
    </>
  );
}

export function HomePage({ auth, converterKey, requireLogin, onSessionExpired }) {
  return (
    <>
      <Hero />

      <Converter
        key={converterKey}
        guest={auth.status !== 'authenticated'}
        quota={auth.quota}
        requireLogin={requireLogin}
        onSessionExpired={onSessionExpired}
        onQuotaChange={auth.refresh}
      />

      <HowItWorks />
      <PlatformSupport />
      <Limitations />
    </>
  );
}
