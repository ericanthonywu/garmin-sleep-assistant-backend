import { HealthService } from '../services/health.service.js';
import { todayStr, daysAgo } from '../utils/date.js';

export class SyncController {
  static async triggerSync(req, res, next) {
    try {
      const { startDate, endDate } = req.body || {};
      const end = endDate || todayStr();
      const start = startDate || daysAgo(7);

      const count = await HealthService.syncFromIntervals(start, end);

      res.json({
        success: true,
        message: `Successfully synchronized ${count} days from Intervals.icu`,
        data: {
          daysSynced: count,
          range: { start, end },
        },
      });
    } catch (err) {
      next(err);
    }
  }
}
