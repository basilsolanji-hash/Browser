import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AnalyticsStore } from './analytics.mjs';
import { createAdminServer } from './admin.mjs';
process.umask(0o077);
const directory = process.env.OS_SERVICE_DATA;
if (!directory) throw new Error('OS_SERVICE_DATA is required');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const analytics = new AnalyticsStore(join(directory, 'analytics.sqlite'));
let cleanup;
function scheduleCleanup() {
  analytics.purge();
  const now = Date.now();
  const tomorrow = new Date(now); tomorrow.setUTCHours(24, 0, 0, 0);
  cleanup = setTimeout(scheduleCleanup, tomorrow.getTime() - now + 1);
  cleanup.unref();
}
scheduleCleanup();
const server = createAdminServer({ origin: process.env.OS_ADMIN_ORIGIN,
  secret: process.env.OS_ADMIN_SECRET, analytics });
server.listen(Number(process.env.PORT ?? 8090), '127.0.0.1', () => console.log('Owner panel listening on loopback'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { clearTimeout(cleanup); analytics.close(); process.exit(0); }));
