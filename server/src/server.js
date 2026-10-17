import 'dotenv/config';
import { createApp } from './app.js';
import { openDatabase } from './db/database.js';
import { bootstrapAdmin } from './services/users.service.js';
import { purgeExpiredSessions } from './services/session.service.js';
import { runHealthCheck, healthScheduleHours } from './services/health.service.js';

const PORT = process.env.PORT || 5000;

// Users, sessions and the usage log (never conversation content)
const db = openDatabase();
const adminMessage = await bootstrapAdmin(db);
if (adminMessage) console.log(`[Server] ${adminMessage}`);

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000).unref();

const app = createApp({ db });

// Scheduled platform health check (admins save the test links in the dashboard).
// HEALTH_CHECK_INTERVAL_HOURS=0 turns it off.
const healthHours = healthScheduleHours();
if (healthHours > 0) {
  setInterval(async () => {
    try {
      const results = await runHealthCheck(app.locals, { runBy: 'scheduled' });
      const broken = results.filter((r) => !r.ok).map((r) => `${r.platform} (${r.outcome})`);
      if (results.length) console.log(`[health] ${results.length} platform(s) checked${broken.length ? `; NOT working: ${broken.join(', ')}` : ', all working'}`);
    } catch (err) {
      console.warn('[health] scheduled check skipped:', err.message);
    }
  }, healthHours * 60 * 60 * 1000).unref();
}

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
    db.close();
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
  // Force exit if in-flight conversions do not finish in time
  setTimeout(() => process.exit(1), 30_000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default server;
