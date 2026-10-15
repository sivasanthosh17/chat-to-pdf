/**
 * live-check.mjs — opt-in real-world smoke test for the extractors.
 *
 *   npm run check:live -- <share-url> [<share-url> ...]
 *   npm run check:live -- --pdf <share-url>     (also renders the PDF and runs the text check)
 *
 * Contacts the real platforms, so it is NOT part of `npm test`. Prints only
 * metadata (counts, grades, warnings) — never conversation content — and
 * stores nothing. Use it when a platform changes its pages to see which
 * extractor needs attention.
 */

import { validateConversationUrl } from '../src/services/urlValidator.service.js';
import { defaultExtractors } from '../src/extractors/index.js';
import { verifyConversation } from '../src/verification/verification.service.js';
import { renderConversationToPdf } from '../src/pdf/pdf.service.js';

const args = process.argv.slice(2);
const withPdf = args.includes('--pdf');
const urls = args.filter((a) => !a.startsWith('--'));

if (urls.length === 0) {
  console.error('Usage: npm run check:live -- [--pdf] <share-url> [<share-url> ...]');
  process.exit(2);
}

let failures = 0;
for (const url of urls) {
  const started = Date.now();
  const label = url.replace(/^https:\/\//, '').slice(0, 60);
  try {
    const validation = await validateConversationUrl(url);
    if (!validation.isValid) throw Object.assign(new Error(validation.error), { code: 'UNSUPPORTED_URL' });

    const conversation = await defaultExtractors[validation.platform](validation);
    const report = verifyConversation(conversation);
    const roles = conversation.messages.map((m) => (m.role === 'user' ? 'U' : 'A')).join('');
    console.log(`\n✔ ${label}`);
    console.log(`  platform=${validation.platform} messages=${conversation.messages.length} status=${conversation.extractionStatus} grade=${report.grade} (${Date.now() - started} ms)`);
    console.log(`  roles=${roles.length > 60 ? roles.slice(0, 60) + '…' : roles}`);
    console.log(`  method=${conversation.verification.verificationMethod} verified=${conversation.verification.isVerified}`);
    for (const e of report.errors) console.log(`  ERROR   ${e}`);
    for (const w of report.warnings) console.log(`  warning ${w.slice(0, 200)}`);

    if (withPdf && report.passed) {
      const pdf = await renderConversationToPdf(conversation, report);
      console.log(`  pdf=${pdf.buffer.length} bytes pages=${pdf.pageCount} textCheck=${pdf.regressionCheck.passed ? 'passed' : 'FAILED'} (${pdf.regressionCheck.checkedCount} segments)`);
    }
  } catch (err) {
    failures++;
    console.log(`\n✘ ${label}\n  ${err.code || 'ERROR'}: ${err.message}`);
  }
}

process.exit(failures ? 1 : 0);
