/**
 * wording.js — small helpers so user-facing text reads naturally
 * ("1 attachment", "4 tool outputs", "a, b and c") instead of "1 × x(s)".
 */

const IRREGULAR = {
  reasoning: 'reasoning steps',
  'reasoning step': 'reasoning steps',
  'code execution': 'code executions',
  'uploaded file': 'uploaded files',
  'platform activity': 'platform activity'
};

/** "1 image", "3 images", "2 reasoning steps" */
export function plural(count, singular, pluralForm) {
  if (count === 1) return `1 ${singular === 'reasoning' ? 'reasoning step' : singular}`;
  return `${count} ${pluralForm || IRREGULAR[singular] || `${singular}s`}`;
}

/** "a", "a and b", "a, b and c" */
export function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** "message 2", "messages 2 and 5" */
export function messageList(numbers) {
  return `${numbers.length === 1 ? 'message' : 'messages'} ${joinList(numbers.map(String))}`;
}

/** Turns { label: count } into ["1 attachment", "4 tool outputs"] */
export function countPhrases(counts) {
  return Object.entries(counts).map(([label, count]) => plural(count, label));
}
