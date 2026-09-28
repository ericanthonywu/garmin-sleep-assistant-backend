import { HealthService } from '../services/health.service.js';
import { GarminConnectService } from '../services/garmin-connect.service.js';
import { ReportRepo } from '../repositories/report.repo.js';
import { generateMorningReportForDate } from '../jobs/morning-report.job.js';
import { todayStr, daysAgo } from '../utils/date.js';

export class SyncController {
  static async triggerSync(req, res, next) {
    try {
      const { startDate, endDate } = req.body || {};
      const end = endDate || todayStr();
      const start = startDate || daysAgo(7);

      const count = await HealthService.syncFromIntervals(start, end);
      let garminCount = 0;
      try {
        const garminRes = await GarminConnectService.sync(start, end, { useCache: true });
        garminCount = garminRes?.importedCount || 0;
      } catch (garminErr) {
        console.warn('[SyncController] Garmin sync warning:', garminErr.message);
      }

      // Check if morning report should be generated
      const existingReport = await ReportRepo.getByDate(end);
      const needsReport = !existingReport || (existingReport.content && existingReport.content.includes('check your bedtime consistency'));
      if (needsReport) {
        const dash = await HealthService.getDashboardData(end);
        if (dash && dash.sleepHours > 0 && dash.wakeTime) {
          generateMorningReportForDate(end, false).catch((err) => {
            console.warn('[SyncController] Morning report generation deferred:', err.message);
          });
        }
      }

      res.json({
        success: true,
        message: `Successfully synchronized ${count} days from Intervals.icu, ${garminCount} days from Garmin`,
        data: {
          daysSynced: count,
          garminDaysSynced: garminCount,
          range: { start, end },
        },
      });
    } catch (err) {
      next(err);
    }
  }

  static async triggerGarminSync(req, res, next) {
    try {
      const { startDate, endDate } = req.body || {};
      const end = endDate || todayStr();
      const start = startDate || daysAgo(7);

      const garminRes = await GarminConnectService.sync(start, end, { useCache: true });

      // Check if morning report should be generated
      const existingReport = await ReportRepo.getByDate(end);
      const needsReport = !existingReport || (existingReport.content && existingReport.content.includes('check your bedtime consistency'));
      if (needsReport) {
        const dash = await HealthService.getDashboardData(end);
        if (dash && dash.sleepHours > 0 && dash.wakeTime) {
          generateMorningReportForDate(end, false).catch((err) => {
            console.warn('[SyncController] Morning report generation deferred:', err.message);
          });
        }
      }

      res.json({
        success: true,
        message: `Successfully synchronized ${garminRes.importedCount} days from Garmin Connect`,
        data: garminRes,
      });
    } catch (err) {
      next(err);
    }
  }
}
