import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import routes from './routes/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { securityHeaders, frontendSecurityHeaders } from './middleware/securityHeaders.js';
import { createRateLimiter } from './middleware/rateLimiter.js';
import { requestTimeout } from './middleware/requestTimeout.js';
import { defaultExtractors } from './extractors/index.js';
import { renderConversationToPdf } from './pdf/pdf.service.js';
import { AppError, toErrorBody } from './utils/errors.js';

const MINUTE = 60_000;
const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

/**
 * Builds the Express application.
 *
 * @param {object} [options]
 * @param {object} [options.extractors]       - platform → extractor (tests inject fakes)
 * @param {Function} [options.renderPdf]      - PDF renderer (tests may inject)
 * @param {object} [options.validatorOptions] - e.g. { skipDns: true } for offline tests
 * @param {object} [options.rateLimits]       - override { conversion, validation } limits
 * @param {string} [options.clientDistDir]    - serve the built frontend from here (default: CLIENT_DIST_DIR)
 * @returns {import('express').Express}
 */
export function createApp(options = {}) {
  const app = express();

  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) {
    // e.g. "1" when running behind exactly one reverse proxy
    app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  }

  app.locals.extractors = { ...defaultExtractors, ...(options.extractors || {}) };
  app.locals.renderPdf = options.renderPdf || renderConversationToPdf;
  app.locals.validatorOptions = options.validatorOptions || {};

  // Security & Parsing Middleware
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: [
      'Content-Disposition',
      'X-Verification-Grade',
      'X-Verification-Warnings',
      'X-Verification-Report',
      'X-Regression-Check',
      'X-Message-Count',
      'X-Page-Count',
      'X-Platform',
      'Retry-After'
    ],
    maxAge: 600
  }));
  app.use('/api', securityHeaders);

  // Requests are tiny ({ url, platform }); anything larger is rejected early
  app.use(express.json({ limit: '16kb' }));

  // Request logging (method, path, status, duration — never bodies)
  app.use(requestLogger);

  // Rate limits: conversions are expensive (a headless browser per request)
  const limits = options.rateLimits || {};
  const conversionLimiter = createRateLimiter({
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * MINUTE),
    max: limits.conversion ?? num(process.env.RATE_LIMIT_CONVERSIONS, 20),
    name: 'conversion requests'
  });
  const validationLimiter = createRateLimiter({
    windowMs: MINUTE,
    max: limits.validation ?? num(process.env.RATE_LIMIT_VALIDATIONS, 120),
    name: 'validation requests'
  });
  app.locals.rateLimiters = { conversionLimiter, validationLimiter };

  const conversionTimeout = requestTimeout(num(process.env.REQUEST_TIMEOUT_MS, 180_000));
  app.use('/api/convert', conversionLimiter, conversionTimeout);
  app.use('/api/extract', conversionLimiter, conversionTimeout);
  app.use('/api/validate-url', validationLimiter, requestTimeout(15_000));

  // API Routes
  app.use('/api', routes);

  // Optional: serve the built frontend (client/dist) from the same origin, so
  // production needs only one process and no cross-origin requests.
  const clientDir = options.clientDistDir ?? process.env.CLIENT_DIST_DIR;
  if (clientDir && existsSync(join(clientDir, 'index.html'))) {
    const root = resolve(clientDir);
    app.use((req, res, next) => (/^\/api(\/|$)/.test(req.path) ? next() : frontendSecurityHeaders(req, res, next)));
    app.use('/assets', express.static(join(root, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(root, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api(\/|$)).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(root, 'index.html'));
    });
  }

  // 404 Handler
  app.use((req, res) => {
    const err = new AppError('INVALID_REQUEST', `Endpoint ${req.method} ${req.path} not found`);
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    res.status(404).json(toErrorBody(err));
  });

  // Centralized Error Handling Middleware
  app.use(errorHandler);

  return app;
}

const app = createApp();
export default app;
