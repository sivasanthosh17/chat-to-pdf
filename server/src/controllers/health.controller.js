import { getBrowserPoolStats } from '../services/browser.service.js';

/**
 * Health check controller providing system status and verification.
 */
export function getHealthStatus(req, res) {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      service: 'chat-to-pdf-server',
      version: '1.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
      conversionCapacity: getBrowserPoolStats(),
      timestamp: new Date().toISOString()
    }
  });
}
