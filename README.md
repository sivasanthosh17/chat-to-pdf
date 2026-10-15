# ChatPDF Studio — Multi-Platform Chat-to-PDF Converter

Converts **public** shared conversation links from **ChatGPT**, **Google Gemini** and **Claude** into
downloadable A4 PDFs. Message text is copied verbatim — never rewritten, summarised, translated or
"corrected" — and every PDF states, on its first page, how thoroughly its content could be verified.

| | |
|---|---|
| Frontend | React 19 + Vite, plain CSS (light/dark, mobile-first) |
| Backend | Node.js 22 + Express 4 (ES modules), Zod |
| Retrieval & PDF | Playwright + Chromium, Cheerio, PDF.js (`pdfjs-dist`) for the post-render text check |
| Tests | Node's built-in test runner (`node:test`) — 124 tests, no network access needed |

---

## Status

All eight phases of the project plan are implemented.

| Phase | Scope | State |
|---|---|---|
| 1 | Project setup, React ↔ Express | Done |
| 2 | URL validation, platform detection, normalized schema | Done |
| 3 | ChatGPT extractor | Done — tested on live public shares |
| 4 | Verification and PDF generation | Done |
| 5 | Gemini extractor | Done — tested on a live public share (see limits below) |
| 6 | Claude extractor | Done — tested on live public shares; blocked whenever Claude shows a bot check |
| 7 | Automated tests, security hardening, error handling | Done |
| 8 | Final UI, documentation, deployment | Done — Docker image written but not built in the development environment (Docker was not installed) |

### What each extractor can honestly promise

Real-world testing was done in October 2026 against public share links found on Hacker News and Medium.

| Platform | How the conversation is retrieved | Verification | Real-world testing |
|---|---|---|---|
| **ChatGPT** | The JSON the share page itself loads (`chatgpt.com/backend-api/share/<id>`); rendered page as a fallback | **Verified.** Messages are compared character-for-character against `linear_conversation`, a separate copy of the active branch in the same payload | 8 public shares, 161 messages: all matched exactly; deleted share → "not found" |
| **Gemini** | Public page rendered in a network-restricted headless browser; message DOM is read | **Unverified.** Gemini exposes no independent copy. Turn structure and text are cross-checked against the raw page text, and the PDF is labelled unverified | 1 public share (20 turns, 40 messages) matched; deleted link → "not found". Code blocks, tables, math and images were **not present** in that share; they use generic HTML handling and still need real-world confirmation |
| **Claude** | Public page rendered in a network-restricted browser; the page's own `chat_snapshots` response is read passively | **Unverified.** Order and completeness are confirmed through the `parent_message_uuid` chain, but the text exists in only one copy | 5 public shares matched; deleted share → "not found". Claude **intermittently shows a Cloudflare bot check** to automated browsers; the app does not bypass it and reports "Blocked by the platform" |

Platforms change their pages without notice. `npm run check:live` (below) re-tests any link in seconds.

---

## Architecture

```
Browser (React)                     Express API                                  Platforms
───────────────                     ───────────                                  ─────────
URL + platform ──POST /api/convert──▶ Zod body check
                                    ▶ URL validator (HTTPS, exact host allowlist,
                                      no IP literals/creds/ports, DNS → public IPs only)
                                    ▶ platform extractor ───── safeFetch (manual, re-validated redirects,
                                    │                          size + time limits) ─────────────────▶ chatgpt.com
                                    │                    └──── headless Chromium (HTTPS host-suffix
                                    │                          allowlist, no images/fonts/websockets) ─▶ gemini / claude
                                    ▶ normalized schema (Zod)
                                    ▶ verification service ── grade: verified · verified_with_warnings
                                    │                                · unverified · incomplete · failed (no PDF)
                                    ▶ HTML template (all text escaped, no scripts, CSP)
                                    ▶ Chromium → PDF (no network, JavaScript off)
                                    ▶ PDF.js reads the PDF text layer back → every paragraph,
                                      list item, table cell and code block must be present
◀── PDF + X-Verification-* headers ─┘
```

### Content-fidelity design

- `originalText` is the platform's text, byte for byte. `structuredBlocks` (headings, lists, code,
  tables, quotes) are only used for layout, and the verification service **blocks the PDF** if the blocks
  do not reproduce every character of the message.
- If formatting cannot be reproduced exactly, the message falls back to a preformatted plain-text block —
  formatting degrades, content never does.
- User prompts are rendered as plain text (as the platforms show them), so `*` or `_` in a prompt stay as typed.
- Things that cannot be reproduced — images, attachments, tool calls, web searches, code execution output,
  reasoning traces — are never dropped silently: the PDF shows a "Not included in this PDF" notice where they
  occurred, and the verification report counts them.
- ChatGPT citation markers (private-use Unicode such as `cite…`) are replaced with the label
  ChatGPT displays; `originalText` keeps the raw markers.
- Duplicate messages are kept and flagged.

---

## Getting started (development)

Prerequisites: **Node.js 22+**, npm 10+.

```bash
# Backend
cd server
npm install
npm run install:browser      # downloads Playwright's Chromium (once)
cp .env.example .env         # Windows: copy .env.example .env
npm run dev                  # http://localhost:5000

# Frontend (second terminal)
cd client
npm install
npm run dev                  # http://localhost:5173  (proxies /api → :5000)
```

Open http://localhost:5173, paste a public share link, and choose **Convert to PDF** or **Preview messages**.

### Tests

```bash
cd server
npm test                     # 124 tests, ~45 s; uses saved fixtures, never the network
```

Coverage includes: URL/SSRF validation (private ranges, DNS answers, redirects to other hosts, metadata
endpoints, credentials, ports), all three extractors against saved fixtures, private/deleted links, bot
challenges, network errors and timeouts, duplicates, whitespace and indentation, code blocks, tables,
Unicode (Tamil, CJK, Arabic, emoji), math, a 300-message conversation, malicious markup, rate limiting, CORS,
and **PDF text comparison against the source fixtures** using real Chromium.

Fixtures are synthetic text in the real platforms' structure — see `server/tests/fixtures/README.md`.

### Live check (real platforms, opt-in)

```bash
cd server
npm run check:live -- https://chatgpt.com/share/<id> https://g.co/gemini/share/<id>
npm run check:live -- --pdf https://claude.ai/share/<id>     # also renders and text-checks the PDF
```

Prints counts, grades and warnings only — never conversation content.

### Frontend lint / build

```bash
cd client
npm run lint
npm run build                # → client/dist
```

---

## Deployment

### Option A — Docker (single container)

```bash
docker build -t chatpdf-studio .
docker run --rm -p 5000:5000 -e CORS_ORIGIN=https://your.domain chatpdf-studio
```

The image builds the React app, then runs Express on Playwright's official image
(`mcr.microsoft.com/playwright:v1.64.0-noble`, which **must match** the exact `playwright` version in
`server/package.json`). It adds Noto fonts for Indic, CJK, Arabic and emoji text, serves the frontend and
API from one origin, and runs as the unprivileged `pwuser`.

> The Dockerfile was written and reviewed but **not built** in the development environment (Docker was not
> installed). Build and run it once before relying on it.

**Chromium sandbox in containers.** Playwright runs Chromium without its OS sandbox by default. To enable it
(`PLAYWRIGHT_CHROMIUM_SANDBOX=true`), the container must allow user namespaces — run it with Playwright's
seccomp profile (`--security-opt seccomp=seccomp_profile.json`, from the Playwright repository). Without the
sandbox, the remaining protections still apply: JavaScript is off and the network is blocked during PDF
rendering, and extraction browsers may only reach the platform's own hosts.

### Option B — Node.js on a server / VM

```bash
cd client && npm ci && npm run build
cd ../server && npm ci --omit=dev && npx playwright install --with-deps chromium
NODE_ENV=production CLIENT_DIST_DIR=../client/dist CORS_ORIGIN=https://your.domain \
  PLAYWRIGHT_CHROMIUM_SANDBOX=true TRUST_PROXY=1 node src/server.js
```

Put it behind a reverse proxy (nginx, Caddy) that terminates HTTPS. Set `TRUST_PROXY=1` so rate limiting
sees real client IPs, and allow at least `REQUEST_TIMEOUT_MS` (default 180 s) as the proxy read timeout.
On Linux, install `fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji` for full Unicode output.

To host the frontend separately (static hosting/CDN), build it with `VITE_API_BASE_URL=https://api.your.domain`
and list the frontend origin in the server's `CORS_ORIGIN`.

### Sizing

Each conversion runs a headless Chromium (~150–300 MB RAM). `BROWSER_MAX_CONCURRENCY` (default 2) and
`BROWSER_MAX_QUEUE` (default 8) bound the load; requests beyond that receive `503 BUSY`. The in-memory rate
limiter is per process — use a shared limiter at the proxy if you run several instances.

### Environment variables (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 5000 | HTTP port |
| `NODE_ENV` | development | `production` enables HSTS |
| `CORS_ORIGIN` | http://localhost:5173 | Comma-separated allowed browser origins |
| `CLIENT_DIST_DIR` | — | Serve the built frontend from this directory |
| `TRUST_PROXY` | — | Express `trust proxy` setting (e.g. `1`) |
| `RATE_LIMIT_CONVERSIONS` / `RATE_LIMIT_WINDOW_MS` | 20 / 900000 | Extract + convert requests per IP per window |
| `RATE_LIMIT_VALIDATIONS` | 120 | URL validations per IP per minute |
| `REQUEST_TIMEOUT_MS` | 180000 | Hard limit per conversion request |
| `BROWSER_MAX_CONCURRENCY` / `BROWSER_MAX_QUEUE` / `BROWSER_QUEUE_WAIT_MS` | 2 / 8 / 60000 | Chromium concurrency limits |
| `BROWSER_JOB_TIMEOUT_MS` / `PDF_RENDER_TIMEOUT_MS` | 90000 | Browser job deadlines |
| `PLAYWRIGHT_CHROMIUM_SANDBOX` | false | Enable Chromium's OS sandbox |
| `PLAYWRIGHT_CHROMIUM_PATH` | — | Use a system Chromium |
| `FETCH_TIMEOUT_MS` / `FETCH_MAX_BYTES` | 15000 / 25 MB | Direct HTTP retrieval limits |

---

## API

All errors share one shape:

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…", "statusCode": 404, "retryable": false, "details": {} } }
```

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Status and current conversion capacity |
| `GET /api/platforms` | Supported platforms, hosts and verification level |
| `POST /api/validate-url` `{ url }` | SSRF-checked validation and platform detection |
| `POST /api/extract` `{ url, platform? }` | Normalized conversation + verification report (JSON) |
| `POST /api/convert` `{ url, platform? }` | The PDF (`application/pdf`) |

`platform` is `auto` (default), `chatgpt`, `gemini` or `claude`; a value that doesn't match the URL returns
`422 PLATFORM_MISMATCH`.

`/api/convert` response headers: `X-Verification-Grade`, `X-Verification-Report` (URI-encoded JSON with grade,
method, notes and warnings), `X-Verification-Warnings`, `X-Regression-Check` (`passed`/`failed`),
`X-Message-Count`, `X-Page-Count`, `X-Platform`.

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_REQUEST` | 400 / 413 | Missing/malformed body, body too large |
| `UNSUPPORTED_URL` | 422 | Not an allowlisted public share link, or failed SSRF checks |
| `PLATFORM_MISMATCH` | 422 | Selected platform differs from the link |
| `VERIFICATION_FAILED` | 422 | Integrity checks failed — **no PDF is produced** |
| `NOT_FOUND` | 404 | Private, deleted or mistyped share |
| `ACCESS_BLOCKED` | 403 | Platform bot check (never bypassed) |
| `RATE_LIMITED` | 429 | Too many requests (`Retry-After` header) |
| `UPSTREAM_ERROR` / `UNRECOGNIZED_FORMAT` / `EXTRACTION_FAILED` / `RESPONSE_TOO_LARGE` | 502 | Platform error, page layout changed, or oversized response |
| `BUSY` | 503 | Conversion capacity exhausted |
| `TIMEOUT` | 504 | Platform or browser too slow |
| `PDF_FAILED` / `INTERNAL` | 500 | Rendering or unexpected server error (details only in server logs) |

### Verification grades

| Grade | PDF? | Meaning |
|---|---|---|
| `verified` | Yes | Every message matched an independent copy in the platform data; no warnings |
| `verified_with_warnings` | Yes | Verified, but something needs attention (omitted images/tool output, math shown as LaTeX, duplicates, PDF text check found a gap) |
| `unverified` | Yes, labelled | No independent source exists (Gemini, Claude, ChatGPT DOM fallback) |
| `incomplete` | Yes, with INCOMPLETE banner | The extractor detected missing or mismatched messages |
| `failed` | **No** | Counts, ordering or block fidelity checks failed |

---

## Security

- **SSRF:** HTTPS only; exact hostname allowlist (`g.co/gemini/share/<id>` is rewritten locally, not fetched);
  IP literals, credentials and non-443 ports rejected; every DNS answer must be public (loopback, RFC 1918,
  CGNAT, link-local/metadata, ULA, IPv4-mapped forms blocked); redirects are followed manually and each hop is
  re-validated; response size and time limits.
- **Headless browsers:** every request is checked against the platform's HTTPS host-suffix allowlist (analytics,
  IP literals and internal hosts are aborted); images, fonts, media, WebSockets and service workers are
  blocked; concurrency and hard deadlines are enforced; the browser is always closed.
- **PDF rendering:** a static template with every piece of text escaped, a `default-src 'none'` CSP, JavaScript
  disabled and no network access.
- **API:** Zod validation, 16 KB body limit, per-IP rate limits, request timeouts, CORS allowlist, security
  headers, generic messages for 5xx errors, and no conversation content or request bodies in logs.
- **Storage:** nothing is written to disk; PDFs are streamed from memory with `Cache-Control: no-store`.
- **Access controls:** private conversations, logins, CAPTCHAs and bot checks are never bypassed. No stealth
  plugins are used.

Known limitation: Node's `fetch` resolves DNS again when it connects, so a DNS answer that changes between
the check and the connection is not fully excluded. Exposure is small, because only a few exact, well-known
platform hostnames are ever contacted.

---

## Fidelity limitations

- Images, file attachments, generated media, Canvas/artifact documents, tool calls, web searches, code
  execution output and reasoning traces are not reproduced; each occurrence is marked in the PDF.
- Math is shown as LaTeX source, not typeset.
- Gemini and Claude results are labelled unverified because those platforms provide no second copy of the text.
- Gemini code blocks, tables, math and images use generic HTML handling that has not yet been confirmed on a
  live share containing them.
- The post-render PDF text check can report false gaps for right-to-left text mixed with digits or Latin
  words; the PDF is still produced, with a warning.
- Unicode output depends on installed fonts (see Deployment).
- Very long conversations are supported (a 228-page, 122-message live share rendered and passed the text
  check), limited only by `REQUEST_TIMEOUT_MS` and memory.

---

## Project structure

```
client/
  src/
    components/   ConverterForm, ConversionProgress, ResultPanel, ErrorPanel,
                  ConversationViewer (preview), PlatformSupport, Navbar
    hooks/        useConversion (run/cancel/retry), useUrlValidation (debounced), useServerHealth
    services/     api.js (typed results), outcomes.js (grade/error → UI category)
    pages/        HomePage.jsx
server/
  src/
    app.js                  createApp(): middleware, limits, routes, optional static frontend
    controllers/            convert, extract, validate, health
    extractors/             chatgpt / gemini / claude extractors, registry (index.js)
      shared/               markdown parser, HTML → blocks, message builder, text comparison
    middleware/             error handler, rate limiter, request timeout, security headers, logger
    pdf/                    pdf.service.js (render + text check), pdfText.js (PDF.js reader)
    schemas/                Zod schemas (normalized conversation, requests)
    services/               urlValidator (SSRF), safeFetch, browser (sandboxed Chromium pool),
                            conversion pipeline, platform metadata
    templates/              conversation.template.js (escaped, script-free HTML for the PDF)
    utils/errors.js         AppError + error codes
    verification/           verification.service.js (grades)
  scripts/live-check.mjs    opt-in real-platform smoke test
  tests/                    node:test suites + synthetic fixtures
Dockerfile                  single-container deployment
```

Additions to the originally planned structure: `extractors/shared/` holds the parsing code all three extractors
use; `utils/` holds shared error types; `scripts/` holds the live check. A test helper in `tests/` replaces
the per-file server setup.
