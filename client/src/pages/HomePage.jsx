import React, { useEffect, useState } from 'react';
import { Navbar } from '../components/Navbar';
import { Hero } from '../components/Hero';
import { ConverterForm } from '../components/ConverterForm';
import { ConversionProgress } from '../components/ConversionProgress';
import { ResultPanel } from '../components/ResultPanel';
import { ErrorPanel } from '../components/ErrorPanel';
import { ConversationViewer } from '../components/ConversationViewer';
import { RecentConversions } from '../components/RecentConversions';
import { HowItWorks, PlatformSupport, Limitations } from '../components/InfoSections';
import { Icon } from '../components/Icon';
import { useServerHealth } from '../hooks/useServerHealth';
import { useConversion } from '../hooks/useConversion';

export function HomePage() {
  const health = useServerHealth();
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

  const fillLink = (item) => {
    setUrl(item.url);
    setPlatform(item.platform || 'auto');
    document.getElementById('share-url')?.focus();
  };

  return (
    <div className="app" id="top">
      <div className="backdrop" aria-hidden="true" />
      <Navbar serverStatus={health.status} onRecheck={health.recheck} />

      <main className="main">
        <Hero />

        {health.status === 'error' && (
          <div className="banner" role="status">
            <Icon name="alert" size={18} />
            <span>
              The conversion server is not reachable. Start the backend (<code>cd server &amp;&amp; npm run dev</code>) and{' '}
              <button type="button" className="link-button" onClick={health.recheck}>check again</button>.
            </span>
          </div>
        )}

        <section className="card converter-card" aria-label="Convert a shared conversation">
          <ConverterForm
            url={url}
            onUrlChange={setUrl}
            platform={platform}
            onPlatformChange={setPlatform}
            busy={busy}
            onSubmit={convert}
          />
        </section>

        {state.status === 'running' && (
          <ConversionProgress
            mode={state.mode}
            stages={state.stages}
            elapsed={elapsed}
            startedAt={state.startedAt}
            onCancel={cancel}
          />
        )}

        {state.status === 'error' && <ErrorPanel error={state.error} onRetry={retry} onReset={reset} />}

        {state.status === 'success' && state.mode === 'pdf' && (
          <ResultPanel
            key={state.id}
            result={state.result}
            durationMs={state.durationMs}
            fromHistory={state.fromHistory}
            onReset={reset}
          />
        )}

        {state.status === 'success' && state.mode === 'inspect' && (
          <ConversationViewer
            conversation={state.result.conversation}
            verification={state.result.verification}
            onClose={reset}
          />
        )}

        <RecentConversions
          items={history}
          activeId={state.status === 'success' || state.status === 'error' ? state.id : null}
          onShow={show}
          onRetry={(item) => {
            fillLink(item);
            convert({ mode: 'pdf', url: item.url, platform: item.platform });
          }}
          onUseLink={fillLink}
          onClear={clearHistory}
        />

        <HowItWorks />
        <PlatformSupport />
        <Limitations />
      </main>

      <footer className="footer">
        <span className="brand-name small">ChatPDF<span>Studio</span></span>
        <span>Conversations are processed in memory and never stored.</span>
      </footer>
    </div>
  );
}
