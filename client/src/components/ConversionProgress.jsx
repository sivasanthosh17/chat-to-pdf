import React from 'react';
import { PLATFORM_NAMES } from '../services/outcomes';
import { Icon } from './Icon';

const PDF_STEPS = [
  { id: 'validating', label: 'Check link', detail: 'HTTPS, allowed platform, safe address' },
  { id: 'retrieving', label: 'Retrieve conversation', detail: 'Reading the public share page' },
  { id: 'verifying', label: 'Verify messages', detail: 'Counts, order and exact text' },
  { id: 'rendering', label: 'Render PDF', detail: 'A4 layout from an escaped template' },
  { id: 'checking', label: 'Check PDF text', detail: 'Reading the PDF back to confirm nothing was lost' }
];

const SLOW_PLATFORMS = new Set(['gemini', 'claude']);

function seconds(ms) {
  return ms < 1000 ? `${Math.max(ms, 0)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Step tracker driven by the server's real stage events (POST
 * /api/convert/stream). Each finished step shows how long it actually took.
 * Preview mode uses a non-streaming request, so it shows a single honest
 * "working" state instead.
 */
export function ConversionProgress({ mode, stages = [], elapsed, startedAt, onCancel }) {
  const retrieving = stages.find((s) => s.stage === 'retrieving');
  const verifying = stages.find((s) => s.stage === 'verifying');
  const platform = retrieving?.info?.platform;
  const lastStage = stages.at(-1)?.stage;
  const currentIndex = PDF_STEPS.findIndex((s) => s.id === lastStage);
  const rerendering = stages.filter((s) => s.stage === 'rendering').length > 1;

  const stageOf = (id) => stages.filter((s) => s.stage === id).at(-1);
  const startedOf = (id) => stageOf(id)?.at;
  // Finished-step durations use the server's timestamps (exact even when
  // several events arrive together); the running step uses the local clock.
  const durationOf = (i) => {
    const start = stageOf(PDF_STEPS[i].id);
    const end = stageOf(PDF_STEPS[i + 1]?.id);
    if (!start || !end) return null;
    return start.serverAt && end.serverAt ? end.serverAt - start.serverAt : end.at - start.at;
  };

  const progress = mode === 'pdf' ? Math.max(0, (currentIndex + 0.5) / PDF_STEPS.length) : null;
  const nowMs = startedAt + elapsed * 1000;

  return (
    <section className="card progress-card" aria-live="polite" aria-busy="true">
      <div className="progress-top">
        <div className="progress-title">
          <span className="orbit" aria-hidden="true"><span /></span>
          <div>
            <h2 className="card-title">{mode === 'pdf' ? 'Converting to PDF' : 'Retrieving conversation'}</h2>
            <p className="card-subtitle">
              <Icon name="clock" size={14} /> {elapsed.toFixed(0)} s elapsed
              {platform ? ` · ${PLATFORM_NAMES[platform]}` : ''}
              {verifying?.info?.messageCount ? ` · ${verifying.info.messageCount} messages found` : ''}
            </p>
          </div>
        </div>
        <button type="button" className="button button-ghost" onClick={onCancel}>
          <Icon name="x" size={16} /> Cancel
        </button>
      </div>

      {mode === 'pdf' ? (
        <>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </div>
          <ol className="stepper">
            {PDF_STEPS.map((step, i) => {
              const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending';
              const took = state === 'done' ? durationOf(i) : null;
              const activeFor = state === 'active' && startedOf(step.id) ? nowMs - startedOf(step.id) : null;
              return (
                <li key={step.id} className={`step is-${state}`}>
                  <span className="step-icon" aria-hidden="true">
                    {state === 'done' ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}
                  </span>
                  <div className="step-text">
                    <span className="step-label">
                      {step.id === 'rendering' && rerendering ? 'Render PDF (second pass)' : step.label}
                    </span>
                    <span className="step-detail">{step.detail}</span>
                  </div>
                  <span className="step-time">
                    {took !== null ? seconds(took) : activeFor !== null ? `${(activeFor / 1000).toFixed(0)} s` : ''}
                    <span className="sr-only">{state === 'done' ? ' (done)' : state === 'active' ? ' (in progress)' : ''}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {platform && SLOW_PLATFORMS.has(platform) && lastStage === 'retrieving' && (
            <p className="progress-note">
              <Icon name="info" size={14} /> {PLATFORM_NAMES[platform]} pages are loaded in a real browser first — this step usually takes 15–60 s.
            </p>
          )}
        </>
      ) : (
        <div className="progress-track is-indeterminate" aria-hidden="true"><span /></div>
      )}
      <span className="sr-only">Started {new Date(startedAt).toLocaleTimeString()}</span>
    </section>
  );
}
