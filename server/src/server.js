import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`[Server] Chat-to-PDF backend running on http://localhost:${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] Health check available at: http://localhost:${PORT}/api/health`);
});

// Slow or idle clients must not hold connections open indefinitely
server.headersTimeout = 30_000;
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 180_000) + 10_000;
server.keepAliveTimeout = 5_000;

// Log (without conversation content) instead of crashing on stray rejections
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled promise rejection:', reason instanceof Error ? reason.stack : reason);
});

// Graceful shutdown handling
function handleShutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Closing HTTP server cleanly...`);
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
  // Force exit if in-flight conversions do not finish in time
  setTimeout(() => process.exit(1), 30_000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default server;
