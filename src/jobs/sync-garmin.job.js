import cron from 'node-cron';
import { GarminConnectService } from '../services/garmin-connect.service.js';
import { HealthService } from '../services/health.service.js';
import { ReportRepo } from '../repositories/report.repo.js';
import { generateMorningReportForDate } from './morning-report.job.js';
import { todayStr, daysAgo } from '../utils/date.js';

export async function performGarminSync(triggerSource = 'cron') {
  const end = todayStr();
  const start = daysAgo(3);

  try {
    console.log(`[sync-garmin] [${triggerSource}] Starting Garmin Connect sync for ${start} -> ${end}...`);
    const res = await GarminConnectService.sync(start, end, { useCache: true });
    console.log(`[sync-garmin] [${triggerSource}] Synced ${res.importedCount} days from Garmin Connect.`);

    // Check if today's morning report needs generation
    const existingReport = await ReportRepo.getByDate(end);
    const needsReport = !existingReport || (existingReport.content && existingReport.content.includes('check your bedtime consistency'));

    if (needsReport) {
      const dash = await HealthService.getDashboardData(end);
      if (dash && dash.sleepHours > 0 && dash.wakeTime) {
        console.log(`[sync-garmin] Fresh finalized sleep detected for ${end} (${dash.sleepFormatted}, wake: ${dash.wakeTime}). Generating morning report...`);
        await generateMorningReportForDate(end, false);
      }
    }
  } catch (err) {
    console.error(`[sync-garmin] [${triggerSource}] Sync error:`, err.message);
  }
}

/**
 * Periodically pulls the latest sleep data from Garmin Connect via OAuth tokens.
 * Runs every 30 minutes (staggered at minute 5 and 35).
 * Also performs an initial sync 5 seconds after startup.
 */
export function startGarminSyncJob() {
  cron.schedule('5,35 * * * *', async () => {
    await performGarminSync('cron');
  });

  console.log('⏰ Garmin Connect sync job scheduled (runs every 30 minutes)');

  // Initial sync on startup
  setTimeout(() => {
    performGarminSync('startup').catch((err) => {
      console.warn('[sync-garmin] Startup sync error:', err.message);
    });
  }, 5000);
}
