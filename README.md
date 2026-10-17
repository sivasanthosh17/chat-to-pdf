# ChatPDF Studio — Multi-Platform Chat-to-PDF Converter

Converts **public** shared conversation links from **ChatGPT**, **Google Gemini** and **Claude** into
downloadable A4 PDFs. Message text is copied verbatim — never rewritten, summarised, translated or
"corrected" — and every PDF states, on its first page, how thoroughly its content could be verified.

| | |
|---|---|
| Frontend | React 19 + Vite, plain CSS (light/dark, mobile-first) |
| Backend | Node.js 22 + Express 4 (ES modules), Zod |
| Retrieval & PDF | Playwright + Chromium, Cheerio, PDF.js (`pdfjs-dist`) for the post-render text check |
| Tests | Node's built-in test runner (`node:test`) — 156 tests, no network access needed |

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
| **Gemini** (incl. `share.gemini.google/…` and `g.co/gemini/share/…` short links) | Public page rendered in a network-restricted headless browser; message DOM is read | **Unverified.** Gemini exposes no independent copy. Turn structure and text are cross-checked against the raw page text, and the PDF is labelled unverified | 3 public shares matched, including one with a code block, table, inline/display math and an image; deleted link → "not found" |
| **Claude** | Public page rendered in a network-restricted browser; the page's own `chat_snapshots` response is read passively | **Unverified.** Order and completeness are confirmed through the `parent_message_uuid` chain, but the text exists in only one copy | 5 public shares matched; deleted share → "not found". Claude **intermittently shows a Cloudflare bot check** to automated browsers; the app does not bypass it and reports "Blocked by the platform" |

Platforms change their pages without notice. `npm run check:live` (below) re-tests any link in seconds, and the
admin dashboard's **Platform health** check does the same on a schedule.

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

Open http://localhost:5173, paste a public share link, and choose **Convert to PDF** or **Preview**. Visitors can
use the page and check links freely; clicking Convert or Preview asks them to log in or create an account, and the
action continues automatically once they have.

**First admin account.** Converting needs an account. Anyone can sign up as a *User* on the page (unless
`ALLOW_SIGNUP=false`); the first *Admin* is created in one of two ways:

```bash
# A) once, from the command line (asks for the password)
cd server
npm run user:create -- --email you@example.com --role admin

# B) or in server/.env — created on start-up when no admin exists yet
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=<at least 10 characters>
```

## Accounts and roles

| | Visitor (not logged in) | User | Admin |
|---|---|---|---|
| Landing page, how it works, platforms | ✓ | ✓ | ✓ |
| Paste a link and see it checked (platform detection) | ✓ | ✓ | ✓ |
| Convert, preview, download options | asked to log in / sign up, then continues | ✓ (up to the daily PDF limit) | ✓ (no rate or daily limit) |
| See "PDFs left today" (converter and Account page) | — | ✓ | — |
| Change own password | — | ✓ | ✓ |
| Dashboard: who is online, PDFs per account, conversions per day / platform / outcome | — | — | ✓ |
| Manage accounts: create, make admin/user, disable/enable, delete, set a daily PDF limit | — | — | ✓ |
| Recent failures, CSV exports, platform health check | — | — | ✓ |

- The server enforces every rule (`401` when not logged in, `403` for a role that is not allowed); the UI
  only hides what you cannot use.
- Passwords: at least 10 characters, stored as salted scrypt hashes. Sessions: a random token in an
  HttpOnly, SameSite=Lax cookie (Secure in production); only its SHA-256 hash is stored; expires after
  `SESSION_TTL_DAYS` (default 7).
- Disabling an account or changing a password signs that account out of its other devices immediately.
- An admin cannot demote, disable or delete themselves, and the last active admin can never be removed.
- Login and sign-up are rate limited per IP; conversions are limited per account (admins exempt).
- State-changing requests from other websites are rejected (Origin check), in addition to SameSite cookies.
- **Daily PDF limit:** each user may make `DAILY_PDF_LIMIT` PDFs a day (default 30; the day resets at 00:00
  UTC). An admin can give an account its own limit or make it unlimited. Previews do not count, admins have
  no limit, and a request over the limit gets `429 QUOTA_EXCEEDED`.
- **What is stored:** accounts (including any custom daily limit), sessions with the time each was last used
  (for "online now"), one usage row per conversion (user, time, platform, outcome, message and page counts,
  duration), and the platform health-check results. **Share links and conversation text are never stored** —
  the one exception is the health-check test links an admin saves on purpose (one per platform). Data lives in
  one SQLite file (`DB_PATH`, default `server/data/chatpdf.db`), using Node's built-in `node:sqlite` — no
  database server and no extra dependency. (It is marked experimental in Node 22; the npm scripts hide that
  warning.)

### Admin dashboard

An admin who logs in lands on the dashboard (`#/admin`); **Open converter** takes them to the converter, which
they use like any user. The dashboard has four sections, each with its own address (`#/admin/accounts` …), and
refreshes every minute:

| Section | What it shows |
|---|---|
| **Overview** | Online now (active in the last 5 minutes), conversions, success rate, active users, pages, average time; conversions per day; top users by PDFs; conversions by platform; outcomes. **Usage log (CSV)** downloads one row per conversion. |
| **Accounts** | Every account with online status or last activity, PDFs / previews / failed attempts in the period, all-time PDFs, and today's PDFs against its daily limit. **Details** opens the account's activity (per day, per platform, latest 25 attempts) and its daily PDF limit: site default, a custom number, or unlimited. **Accounts (CSV)** downloads the table. |
| **Failures** | Failed conversions and previews grouped by problem and platform, with what each problem usually means, and the latest failures with the account. |
| **Platform health** | Saved public test links (one per platform). A check reads each one exactly like a conversion (no PDF is made) and records whether it still works; it runs on demand and every `HEALTH_CHECK_INTERVAL_HOURS` (default 24). The last 10 results per platform are shown. |

The period (7, 30 or 90 days) applies to the overview, accounts, failures and both CSV files. CSV files are
UTF-8 with a byte-order mark (so Excel shows every character), and cells that a spreadsheet could run as a
formula are neutralised.

### Tests

```bash
cd server
npm test                     # 156 tests, about a minute; uses saved fixtures, never the network
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
docker run -d -p 5000:5000 -v chatpdf-data:/app/server/data \
  -e CORS_ORIGIN=https://your.domain \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='<at least 10 characters>' \
  chatpdf-studio
```

The `chatpdf-data` volume keeps accounts and usage counts across upgrades. `ADMIN_*` is only used while no
admin exists; you can remove it afterwards.

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
| `DB_PATH` | ./data/chatpdf.db | SQLite file for accounts, sessions and usage counts |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Creates the first admin on start-up if none exists |
| `ALLOW_SIGNUP` | true | `false` = only admins create accounts |
| `SESSION_TTL_DAYS` | 7 | How long a login lasts |
| `RATE_LIMIT_LOGINS` | 10 | Login / sign-up attempts per IP per 15 minutes |
| `DAILY_PDF_LIMIT` | 30 | PDFs per user per day (resets 00:00 UTC); `0` = no default limit. Admins can override it per account |
| `HEALTH_CHECK_INTERVAL_HOURS` | 24 | How often the platform health check runs; `0` = only when an admin starts it |
| `RATE_LIMIT_CONVERSIONS` / `RATE_LIMIT_WINDOW_MS` | 20 / 900000 | Extract + convert requests per account per window (admins exempt) |
| `RATE_LIMIT_VALIDATIONS` | 120 | URL validations per account per minute |
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

| Endpoint | Access | Purpose |
|---|---|---|
| `GET /api/health` | public | Status and current conversion capacity |
| `GET /api/platforms` | public | Supported platforms, hosts and verification level |
| `GET /api/auth/me` | public | Current user (or `null`), their daily PDF allowance (`quota`), and whether sign-up is open |
| `POST /api/auth/signup` `{ email, password }` | public | Creates a **user** account and logs in |
| `POST /api/auth/login` `{ email, password }` | public | Logs in (sets the session cookie) |
| `POST /api/auth/logout` | public | Ends the session |
| `POST /api/auth/password` `{ currentPassword, newPassword }` | user | Changes the password; signs out other devices |
| `POST /api/validate-url` `{ url }` | public | SSRF-checked validation and platform detection (rate limited per IP) |
| `POST /api/extract` `{ url, platform? }` | user | Normalized conversation + verification report (JSON) |
| `POST /api/convert` `{ url, platform?, options? }` | user | The PDF (`application/pdf`) |
| `POST /api/convert/stream` `{ url, platform?, options? }` | user | Same pipeline as NDJSON: `stage` events, then `result` (PDF as base64 + metadata) or `error` |
| `GET /api/admin/stats?days=7` | admin | Totals, online now, top users, per day, per platform, per outcome |
| `GET /api/admin/users?days=7` | admin | Accounts with PDFs / previews / failures in the period, all-time and today's PDFs, last activity, online now |
| `GET /api/admin/users/:id/activity?days=30` | admin | One account: daily allowance, activity per day and platform, latest 25 attempts |
| `POST /api/admin/users` `{ email, password, role }` | admin | Creates an account |
| `PATCH /api/admin/users/:id` `{ role?, disabled?, dailyPdfLimit?, unlimited? }` | admin | Changes role, enables/disables, or sets the daily PDF limit (`dailyPdfLimit: null` = site default) |
| `DELETE /api/admin/users/:id` | admin | Deletes an account (its usage rows stay, anonymised) |
| `GET /api/admin/failures?days=7` | admin | Failed attempts grouped by problem and platform, plus the latest 50 |
| `GET /api/admin/export/usage.csv?days=30` | admin | One CSV row per conversion (no links, no text) |
| `GET /api/admin/export/users.csv?days=30` | admin | The accounts table as CSV |
| `GET /api/admin/health` | admin | Test links, latest result and last 10 results per platform |
| `PUT /api/admin/health/links` `{ chatgpt?, gemini?, claude? }` | admin | Saves test links (each must be a valid share link of its platform; `""` removes one) |
| `POST /api/admin/health/run` | admin | Runs the check now, one platform at a time (`503 BUSY` while one is running) |

`options.userMessageMaxLines` (1–500) shows only the first N lines of the user's own messages. It is applied after
verification, never to AI replies; each cut is marked in place and listed under "Your download choice" on the
PDF's first page. `options.includeVerificationSummary` (default `false`) prints the verification summary box on the
first page; the INCOMPLETE warning and the in-place "Not included…" notes print regardless. In the UI both are offered
in the **Download options** dialog; the summary choice is remembered in the browser.

`platform` is `auto` (default), `chatgpt`, `gemini` or `claude`; a value that doesn't match the URL returns
`422 PLATFORM_MISMATCH`.

`/api/convert` response headers: `X-Verification-Grade`, `X-Verification-Report` (URI-encoded JSON with grade,
method, notes and warnings), `X-Verification-Warnings`, `X-Regression-Check` (`passed`/`failed`),
`X-Message-Count`, `X-Page-Count`, `X-Platform`.

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_REQUEST` | 400 / 413 | Missing/malformed body, body too large |
| `UNAUTHENTICATED` | 401 | Not logged in, or the session ended |
| `FORBIDDEN` | 403 | The account's role does not allow this (or a cross-site request was blocked) |
| `CONFLICT` | 409 | An account with this email already exists |
| `UNSUPPORTED_URL` | 422 | Not an allowlisted public share link, or failed SSRF checks |
| `PLATFORM_MISMATCH` | 422 | Selected platform differs from the link |
| `VERIFICATION_FAILED` | 422 | Integrity checks failed — **no PDF is produced** |
| `NOT_FOUND` | 404 | Private, deleted or mistyped share |
| `ACCESS_BLOCKED` | 403 | Platform bot check (never bypassed) |
| `RATE_LIMITED` | 429 | Too many requests (`Retry-After` header) |
| `QUOTA_EXCEEDED` | 429 | The account has made today's PDFs (`details.resetsAt`); previews still work |
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

- **SSRF:** HTTPS only; exact hostname allowlist (`g.co/gemini/share/<id>` is rewritten locally; `share.gemini.google/<id>` is resolved with one request whose redirect is read, not followed, and must point to `gemini.google.com/share/…`);
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
- **Storage:** conversations and PDFs are never written to disk — PDFs are streamed from memory with
  `Cache-Control: no-store`. The only stored data is the accounts database described under
  [Accounts and roles](#accounts-and-roles) (no conversation text, and no links except the health-check test
  links an admin saves).
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
