import React from 'react';
import { Navbar } from '../components/Navbar';
import { ConverterForm } from '../components/ConverterForm';
import { ConversionProgress } from '../components/ConversionProgress';
import { ResultPanel } from '../components/ResultPanel';
import { ErrorPanel } from '../components/ErrorPanel';
import { ConversationViewer } from '../components/ConversationViewer';
import { PlatformSupport } from '../components/PlatformSupport';
import { useServerHealth } from '../hooks/useServerHealth';
import { useConversion } from '../hooks/useConversion';

export function HomePage() {
  const health = useServerHealth();
  const { state, elapsed, convert, cancel, retry, reset } = useConversion();
  const busy = state.status === 'running';

  return (
    <div className="app">
      <Navbar serverStatus={health.status} onRecheck={health.recheck} />

      <main className="main">
        <section className="hero">
          <h1>Save shared AI conversations as PDF — word for word.</h1>
          <p>
            Paste a public ChatGPT, Gemini or Claude share link. Messages are copied exactly as written — never
            rewritten, summarised or translated — and every PDF states how thoroughly its content could be verified.
          </p>
        </section>

        {health.status === 'error' && (
          <div className="banner banner-error" role="status">
            The conversion server is not reachable. Start the backend (<code>cd server &amp;&amp; npm start</code>) and{' '}
            <button type="button" className="link-button" onClick={health.recheck}>check again</button>.
          </div>
        )}

        <section className="panel converter-panel">
          <ConverterForm busy={busy} onSubmit={convert} />
        </section>

        {state.status === 'running' && (
          <ConversionProgress mode={state.mode} platform={state.platform} elapsed={elapsed} onCancel={cancel} />
        )}

        {state.status === 'error' && <ErrorPanel error={state.error} onRetry={retry} onReset={reset} />}

        {state.status === 'success' && state.mode === 'pdf' && <ResultPanel result={state.result} onReset={reset} />}

        {state.status === 'success' && state.mode === 'inspect' && (
          <ConversationViewer
            conversation={state.result.conversation}
            verification={state.result.verification}
            onClose={reset}
          />
        )}

        <section className="info-section" aria-labelledby="how-heading">
          <h2 id="how-heading" className="section-title">How it works</h2>
          <ol className="how-list">
            <li><strong>Check the link.</strong> Only public HTTPS share links on the official platform domains are accepted; internal and private network addresses are refused.</li>
            <li><strong>Retrieve the conversation.</strong> The public share page is read the way a browser reads it, with network access limited to that platform. Access controls and bot checks are never bypassed.</li>
            <li><strong>Verify.</strong> Message order, counts and text are checked. ChatGPT shares include an independent copy of each message to compare against; Gemini and Claude do not, so those PDFs are labelled unverified.</li>
            <li><strong>Render and re-check.</strong> The PDF is generated from a fixed template with all text escaped, then its text layer is read back to confirm nothing was lost.</li>
          </ol>
        </section>

        <PlatformSupport />

        <section className="info-section" aria-labelledby="limits-heading">
          <h2 id="limits-heading" className="section-title">Known limitations</h2>
          <ul className="limits-list">
            <li>Images, file attachments, tool calls, web searches and reasoning traces are not reproduced; the PDF marks each place where such content occurred.</li>
            <li>Mathematical expressions appear as their LaTeX source, not typeset formulas.</li>
            <li>Claude sometimes shows a human-verification check to automated browsers; when that happens the conversion stops with a clear message.</li>
            <li>Platforms change their pages without notice. If a link that used to work fails with “Could not read the conversation”, the extractor needs updating.</li>
          </ul>
        </section>
      </main>

      <footer className="footer">
        <p>ChatPDF Studio · Conversations are processed in memory and not stored.</p>
      </footer>
    </div>
  );
}
