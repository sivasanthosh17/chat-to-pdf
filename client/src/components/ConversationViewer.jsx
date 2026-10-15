import React from 'react';
import { PLATFORM_NAMES } from '../services/outcomes';

/**
 * Read-only preview of an extracted conversation (POST /api/extract).
 * All content is rendered as React text nodes — never as HTML.
 */

function Block({ block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(Math.max(block.level + 2, 3), 6)}`;
      return <Tag className="pv-heading">{block.text}</Tag>;
    }
    case 'code':
      return (
        <div className="pv-code">
          <div className="pv-code-lang">{block.language || 'text'}</div>
          <pre><code>{block.code}</code></pre>
        </div>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className="pv-list" start={block.ordered ? block.start : undefined}>
          {block.items.map((item, i) => (
            <li key={i} style={{ marginLeft: `${(block.itemDepths?.[i] || 0) * 1.25}rem` }}>{item}</li>
          ))}
        </Tag>
      );
    }
    case 'table':
      return (
        <div className="pv-table">
          <table>
            {block.headers.length > 0 && (
              <thead><tr>{block.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            )}
            <tbody>
              {block.rows.map((row, r) => <tr key={r}>{row.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      );
    case 'quote':
      return <blockquote className="pv-quote">{block.text}</blockquote>;
    case 'omitted':
      return (
        <div className="pv-omitted">
          Not included in the PDF: {block.kind}{block.label ? ` — ${block.label}` : ''}
        </div>
      );
    default:
      return <p className={`pv-paragraph ${block.preformatted ? 'is-pre' : ''}`}>{block.text}</p>;
  }
}

export function ConversationViewer({ conversation, verification, onClose }) {
  const GRADE_LABELS = {
  verified: 'Verification: verified',
  verified_with_warnings: 'Verification: verified with warnings',
  unverified: 'Verification: unverified (no independent source)',
  incomplete: 'Verification: incomplete extraction'
};
  const assistantName = PLATFORM_NAMES[conversation.platform] || 'Assistant';

  return (
    <section className="panel viewer" aria-label="Conversation preview">
      <div className="viewer-header">
        <div>
          <p className="eyebrow">{PLATFORM_NAMES[conversation.platform]} · {conversation.messages.length} messages</p>
          <h2 className="panel-title">{conversation.title || 'Untitled conversation'}</h2>
          {verification && (
            <p className="panel-subtitle">
              {verification.passed ? (GRADE_LABELS[verification.grade] || verification.grade) : 'Verification failed — a PDF would be blocked'}
              {verification.warnings?.length ? ` · ${verification.warnings.length} warning(s)` : ''}
            </p>
          )}
        </div>
        <button type="button" className="button button-secondary" onClick={onClose}>Close preview</button>
      </div>

      {verification?.errors?.length > 0 && (
        <ul className="detail-list is-error">{verification.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}

      <div className="pv-messages">
        {conversation.messages.map((msg) => (
          <article key={msg.index} className={`pv-message role-${msg.role}`}>
            <header className="pv-message-header">
              <span className="pv-role">{msg.role === 'user' ? 'You' : assistantName}</span>
              <span className="pv-index">#{msg.index + 1}</span>
            </header>
            <div className="pv-body">
              {(msg.structuredBlocks?.length ? msg.structuredBlocks : [{ type: 'paragraph', text: msg.originalText, preformatted: true }])
                .map((block, i) => <Block key={i} block={block} />)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
