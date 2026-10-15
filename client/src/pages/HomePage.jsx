import React, { useEffect, useRef, useState } from 'react';
import { Hero } from '../components/Hero';
import { ConverterForm } from '../components/ConverterForm';
import { ConversionProgress } from '../components/ConversionProgress';
import { ResultPanel } from '../components/ResultPanel';
import { ErrorPanel } from '../components/ErrorPanel';
import { ConversationViewer } from '../components/ConversationViewer';
import { RecentConversions } from '../components/RecentConversions';
import { AuthCard } from '../components/AuthCard';
import { HowItWorks, PlatformSupport, Limitations } from '../components/InfoSections';
import { useConversion } from '../hooks/useConversion';
import { downloadResult } from '../services/download';
import { loadDownloadPrefs } from '../services/preferences';

/**
 * Converter for logged-in users. App keys this component by user id, so the
 * in-tab history (and its PDFs) is discarded on logout or account switch.
 */
function Converter({ onSessionExpired }) {
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

  // The session ended (expired, logged out elsewhere, account disabled)
  useEffect(() => {
    if (state.status === 'error' && state.error?.code === 'UNAUTHENTICATED') onSessionExpired();
  }, [state, onSessionExpired]);

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
            // The first PDF already follows the remembered download preference
            convert(request.mode === 'pdf' ? { ...request, options: loadDownloadPrefs() } : request)
          }
        />
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

export function HomePage({ auth }) {
  return (
    <>
      <Hero />

      {auth.status === 'authenticated' && <Converter key={auth.user.id} onSessionExpired={auth.refresh} />}
      {(auth.status === 'anonymous' || auth.status === 'offline') && (
        <AuthCard signupAllowed={auth.signupAllowed} onLogin={auth.login} onSignup={auth.signup} />
      )}
      {auth.status === 'loading' && <section className="card converter-card auth-loading" aria-busy="true" />}

      <HowItWorks />
      <PlatformSupport />
      <Limitations />
    </>
  );
}
