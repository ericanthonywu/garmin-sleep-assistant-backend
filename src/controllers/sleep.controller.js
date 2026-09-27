import { HealthService } from '../services/health.service.js';
import { SleepEngineService } from '../services/sleep-engine.service.js';
import { todayStr } from '../utils/date.js';

export class SleepController {
  static async getSleepDetail(req, res, next) {
    try {
      const date = req.params.date || todayStr();
      const data = await HealthService.getSleepDetail(date);
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getSleepRecommendation(req, res, next) {
    try {
      const date = req.params.date || todayStr();
      const recommendation = await SleepEngineService.getRecommendation(date);
      res.json({
        success: true,
        data: recommendation,
      });
    } catch (err) {
      next(err);
    }
  }
}
