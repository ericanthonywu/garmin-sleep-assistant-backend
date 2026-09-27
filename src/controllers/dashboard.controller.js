import { HealthService } from '../services/health.service.js';
import { todayStr } from '../utils/date.js';

export class DashboardController {
  static async getDashboard(req, res, next) {
    try {
      const date = req.query.date || todayStr();
      const data = await HealthService.getDashboardData(date);
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  }
}
