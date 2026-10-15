/**
 * Lightweight request logging middleware without logging sensitive payload content.
 * Logs the path only (no query string, no body — request bodies contain user URLs).
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
  });
  next();
}
