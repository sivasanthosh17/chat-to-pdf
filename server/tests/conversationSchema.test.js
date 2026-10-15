import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NormalizedConversationSchema,
  createNormalizedConversation
} from '../src/schemas/conversation.schema.js';

test('Conversation Schema: Validates a complete normalized conversation', () => {
  const validData = {
    platform: 'chatgpt',
    conversationId: 'conv-12345',
    sourceUrl: 'https://chatgpt.com/share/conv-12345',
    title: 'Quantum Computing Fundamentals',
    extractedAt: new Date().toISOString(),
    messages: [
      {
        index: 0,
        role: 'user',
        originalText: 'Explain qubits simply.',
        structuredBlocks: [
          { type: 'paragraph', text: 'Explain qubits simply.' }
        ],
        hasCodeBlocks: false,
        hasTables: false,
        hasMath: false
      },
      {
        index: 1,
        role: 'assistant',
        originalText: 'A qubit is the basic unit of quantum information.',
        structuredBlocks: [
          { type: 'paragraph', text: 'A qubit is the basic unit of quantum information.' }
        ],
        hasCodeBlocks: false,
        hasTables: false,
        hasMath: false
      }
    ],
    extractionStatus: 'complete',
    warnings: [],
    verification: {
      isVerified: true,
      verificationMethod: 'independent_source_match',
      sourceMessageCount: 2,
      extractedMessageCount: 2,
      exactTextMatch: true,
      whitespacePreserved: true,
      unsupportedOmissions: []
    }
  };

  const parsed = createNormalizedConversation(validData);
  assert.equal(parsed.platform, 'chatgpt');
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].role, 'user');
  assert.equal(parsed.messages[1].role, 'assistant');
  assert.equal(parsed.verification.isVerified, true);
});

test('Conversation Schema: Rejects invalid platform identifier', () => {
  assert.throws(() => {
    NormalizedConversationSchema.parse({
      platform: 'unsupported-ai',
      conversationId: '123',
      sourceUrl: 'https://example.com/share/123',
      messages: [{ index: 0, role: 'user', originalText: 'Hi' }],
      extractionStatus: 'complete',
      extractedAt: new Date().toISOString(),
      verification: {
        isVerified: false,
        verificationMethod: 'unverified',
        sourceMessageCount: 1,
        extractedMessageCount: 1,
        exactTextMatch: true,
        whitespacePreserved: true
      }
    });
  });
});

test('Conversation Schema: Rejects empty messages array', () => {
  assert.throws(() => {
    NormalizedConversationSchema.parse({
      platform: 'claude',
      conversationId: '123',
      sourceUrl: 'https://claude.ai/share/123',
      messages: [],
      extractionStatus: 'complete',
      extractedAt: new Date().toISOString(),
      verification: {
        isVerified: false,
        verificationMethod: 'unverified',
        sourceMessageCount: 0,
        extractedMessageCount: 0,
        exactTextMatch: false,
        whitespacePreserved: false
      }
    });
  }, /at least one message/i);
});

test('Conversation Schema: Preserves whitespace and code blocks verbatim', () => {
  const codeText = 'def calculate(x):\n    return x * 2\n';
  const data = {
    platform: 'gemini',
    conversationId: 'code-123',
    sourceUrl: 'https://gemini.google.com/share/code-123',
    title: 'Python Helper',
    extractedAt: new Date().toISOString(),
    messages: [
      {
        index: 0,
        role: 'assistant',
        originalText: codeText,
        structuredBlocks: [
          { type: 'code', language: 'python', code: codeText }
        ],
        hasCodeBlocks: true,
        hasTables: false,
        hasMath: false
      }
    ],
    extractionStatus: 'complete',
    warnings: [],
    verification: {
      isVerified: true,
      verificationMethod: 'independent_source_match',
      sourceMessageCount: 1,
      extractedMessageCount: 1,
      exactTextMatch: true,
      whitespacePreserved: true,
      unsupportedOmissions: []
    }
  };

  const parsed = NormalizedConversationSchema.parse(data);
  // Verify exact whitespace preservation (4 spaces indentation and trailing newline)
  assert.equal(parsed.messages[0].originalText, codeText);
});
