# Test fixtures

All fixtures are **synthetic**: the text is invented, and no real user conversation is stored.
Their *structure* copies what the live platforms returned when inspected in October 2026, so the
extractor tests exercise the same shapes as production.

| File | Mirrors | Verified against live data? |
|---|---|---|
| `chatgpt-share-payload.json` | `GET chatgpt.com/backend-api/share/<id>` (mapping, current_node, linear_conversation, hidden system message, tool calls/output, reasoning, citation markers + content_references, image parts, attachments, an inactive branch) | Yes — field names and content types observed on public shares |
| `chatgpt-nextdata.html` | Legacy `__NEXT_DATA__` share pages | Legacy format; current pages no longer embed it |
| `chatgpt-dom.html` | Rendered DOM with `data-message-author-role` | Selector observed; full DOM not re-verified |
| `gemini-share.html` | Rendered `gemini.google.com/share/<id>` page | Yes — turns, prompts, replies, code blocks, tables, KaTeX math and images |
| `gemini-invalid.html` | Unknown/deleted Gemini share (`invalid-share-link-dialog`) | Yes |
| `claude-snapshot.json` | `GET claude.ai/api/chat_snapshots/<id>` as loaded by the share page | Yes — field names, empty `text`, parent chain observed on public shares |
| `claude-challenge.html` | Cloudflare bot-verification interstitial on `claude.ai/share/*` | Yes (title, wording) |

If a platform changes its page or payload, capture the new structure (not the content) and update both the
fixture and the extractor, then re-run `npm test`.
