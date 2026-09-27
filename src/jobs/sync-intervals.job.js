import cron from 'node-cron';
import { HealthService } from '../services/health.service.js';
import { todayStr, daysAgo } from '../utils/date.js';

/**
 * Periodically pulls the latest wellness and workout data from Intervals.icu.
 * Runs every 30 minutes.
 */
export function startIntervalsSyncJob() {
  cron.schedule('*/30 * * * *', async () => {
    const end = todayStr();
    const start = daysAgo(3);

    try {
      console.log(`[sync-intervals] Starting sync for ${start} -> ${end}...`);
      const count = await HealthService.syncFromIntervals(start, end);
      console.log(`[sync-intervals] Successfully synced ${count} days from Intervals.icu.`);
    } catch (err) {
      console.error('[sync-intervals] Cron sync error:', err.message);
    }
  });

  console.log('⏰ Intervals.icu sync job scheduled (runs every 30 minutes)');
}
