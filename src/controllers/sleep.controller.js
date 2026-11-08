import moment from 'moment-timezone';
import { HealthService } from '../services/health.service.js';
import { SleepEngineService } from '../services/sleep-engine.service.js';
import { requireDateKey, todayStr } from '../utils/date.js';
import { env } from '../config/env.js';

export class SleepController {
  static async getSleepCalendar(req, res, next) {
    try {
      const now = moment().tz(env.TIMEZONE);
      let startDate, endDate;

      if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
        const m = moment.tz(req.query.month, 'YYYY-MM', env.TIMEZONE);
        startDate = m.clone().startOf('month').format('YYYY-MM-DD');
        endDate = m.clone().endOf('month').format('YYYY-MM-DD');
      } else if (req.query.startDate && req.query.endDate) {
        startDate = requireDateKey(req.query.startDate, null, 'startDate');
        endDate = requireDateKey(req.query.endDate, null, 'endDate');
        if (startDate > endDate) {
          const err = new Error('startDate must not be after endDate');
          err.status = 400;
          throw err;
        }
      } else {
        startDate = now.clone().startOf('month').format('YYYY-MM-DD');
        endDate = now.clone().endOf('month').format('YYYY-MM-DD');
      }

      const result = await HealthService.getSleepCalendar(startDate, endDate);
      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getSleepDetail(req, res, next) {
    try {
      const date = requireDateKey(req.params.date, todayStr());
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
      const date = req.params.date
        ? requireDateKey(req.params.date)
        : await SleepEngineService.activeNightDate();
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
