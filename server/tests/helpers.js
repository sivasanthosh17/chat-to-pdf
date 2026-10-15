import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function fixture(name) {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

export function jsonFixture(name) {
  return JSON.parse(fixture(name));
}

/**
 * Starts an Express app on an ephemeral port, runs fn(baseUrl), always closes.
 */
export async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export function postJson(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

/** Minimal valid NormalizedConversation for verification / PDF tests. */
export function makeConversation(overrides = {}) {
  return {
    platform: 'chatgpt',
    conversationId: 'test-conv-001',
    sourceUrl: 'https://chatgpt.com/share/test-001',
    title: 'Test Conversation',
    extractedAt: new Date().toISOString(),
    extractionStatus: 'complete',
    warnings: [],
    verification: {
      isVerified: true,
      verificationMethod: 'independent_source_match',
      sourceMessageCount: 2,
      extractedMessageCount: 2,
      exactTextMatch: true,
      whitespacePreserved: true,
      unsupportedOmissions: [],
      mismatches: []
    },
    messages: [
      {
        index: 0,
        role: 'user',
        originalText: 'Hello, how are you?',
        structuredBlocks: [{ type: 'paragraph', text: 'Hello, how are you?', preformatted: true }],
        hasCodeBlocks: false,
        hasTables: false,
        hasMath: false
      },
      {
        index: 1,
        role: 'assistant',
        originalText: 'I am doing well, thank you for asking!',
        structuredBlocks: [{ type: 'paragraph', text: 'I am doing well, thank you for asking!' }],
        hasCodeBlocks: false,
        hasTables: false,
        hasMath: false
      }
    ],
    ...overrides
  };
}
