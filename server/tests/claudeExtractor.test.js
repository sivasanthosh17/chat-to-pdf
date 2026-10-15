import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeSnapshot, isAccessChallenge } from '../src/extractors/claude.extractor.js';
import { verifyConversation } from '../src/verification/verification.service.js';
import { fixture, jsonFixture } from './helpers.js';

const URL = 'https://claude.ai/share/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('Claude: snapshot messages extracted in order with roles and title', () => {
  const result = parseClaudeSnapshot(jsonFixture('claude-snapshot.json'), URL);
  assert.equal(result.platform, 'claude');
  assert.equal(result.title, 'Synthetic Claude Fixture');
  assert.equal(result.conversationId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.deepEqual(result.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
});

test('Claude: user text verbatim (tabs, spaces, Unicode); no markdown interpretation for prompts', () => {
  const result = parseClaudeSnapshot(jsonFixture('claude-snapshot.json'), URL);
  assert.equal(result.messages[0].originalText, 'Write a *haiku*\n\twith a tab and   spaces');
  assert.equal(result.messages[0].structuredBlocks[0].preformatted, true);
  assert.equal(result.messages[2].originalText, 'Thanks — ありがとう 🙏');
});

test('Claude: text segments around tool use are kept; tool use and attachments are reported', () => {
  const result = parseClaudeSnapshot(jsonFixture('claude-snapshot.json'), URL);
  const reply = result.messages[1];
  assert.ok(reply.originalText.startsWith('Let me check something first.\n\n## Haiku'));

  const code = reply.structuredBlocks.find((b) => b.type === 'code');
  assert.equal(code.code, 'const x = 1;\n  // indented\n');

  const notice = reply.structuredBlocks.find((b) => b.type === 'omitted');
  assert.equal(notice.label, '1 tool use and 1 tool result');

  const userNotice = result.messages[0].structuredBlocks.find((b) => b.type === 'omitted');
  assert.equal(userNotice.kind, 'attachment');
  assert.equal(userNotice.label, 'notes.txt');

  const omissions = result.verification.unsupportedOmissions.join(' | ');
  assert.match(omissions, /1 tool use/);
  assert.match(omissions, /1 attachment/);
});

test('Claude: order confirmed by the parent chain, but text has one copy → unverified', () => {
  const result = parseClaudeSnapshot(jsonFixture('claude-snapshot.json'), URL);
  assert.equal(result.extractionStatus, 'complete');
  assert.equal(result.verification.isVerified, false);
  assert.match(result.verification.notes, /No messages are missing and the order is confirmed/);
  assert.equal(verifyConversation(result).grade, 'unverified');
});

test('Claude: a broken parent chain (missing message) is detected → incomplete', () => {
  const data = jsonFixture('claude-snapshot.json');
  data.chat_messages.splice(1, 1); // drop the first assistant reply
  data.chat_messages.forEach((m, i) => { m.index = i; });
  const result = parseClaudeSnapshot(data, URL);
  assert.equal(result.extractionStatus, 'partial');
  assert.ok(result.verification.mismatches.some((m) => m.includes('the link between messages breaks before message 2')));
  assert.equal(verifyConversation(result).grade, 'incomplete');
});

test('Claude: a populated text field is used as a second copy for verification', () => {
  const data = jsonFixture('claude-snapshot.json');
  for (const m of data.chat_messages) {
    m.text = m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n\n');
  }
  const result = parseClaudeSnapshot(data, URL);
  assert.equal(result.verification.isVerified, true);
  assert.equal(result.verification.verificationMethod, 'independent_source_match');

  data.chat_messages[3].text = 'tampered';
  const tampered = parseClaudeSnapshot(data, URL);
  assert.equal(tampered.verification.isVerified, false);
  assert.ok(tampered.verification.mismatches.length > 0);
});

test('Claude: unrecognised payloads fail closed', () => {
  for (const bad of [{}, { chat_messages: [] }, { chat_messages: 'x' }, { type: 'error', error: { type: 'not_found' } }]) {
    assert.throws(() => parseClaudeSnapshot(bad, URL), (err) => err.code === 'UNRECOGNIZED_FORMAT');
  }
});

test('Claude: Cloudflare challenge page is detected (no bypass is attempted)', () => {
  assert.equal(isAccessChallenge({ html: fixture('claude-challenge.html') }), true);
  assert.equal(isAccessChallenge({ title: 'Just a moment...' }), true);
  assert.equal(isAccessChallenge({ url: 'https://claude.ai/api/challenge_redirect?to=x' }), true);
  assert.equal(isAccessChallenge({ title: 'Claude', url: 'https://claude.ai/share/abc' }), false);
});
