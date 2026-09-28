import { HealthService } from '../services/health.service.js';
import { todayStr } from '../utils/date.js';

export class HealthController {
  static async syncHealthData(req, res, next) {
    try {
      const {
        date,
        sleepStages = [],
        heartRateSamples = [],
        bedtime,
        wakeTime,
        sleepHours,
        sleepScore,
      } = req.body;
      const targetDate = date || todayStr();

      const result = await HealthService.storeHealthKitPayload({
        date: targetDate,
        sleepStages,
        heartRateSamples,
        bedtime,
        wakeTime,
        sleepHours,
        sleepScore,
      });

      res.json({
        success: true,
        message: 'Health data synchronized successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}
