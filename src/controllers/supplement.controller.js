import moment from 'moment-timezone';
import { SupplementRepo } from '../repositories/supplement.repo.js';
import { BedtimeRepo } from '../repositories/bedtime.repo.js';
import { SleepEngineService } from '../services/sleep-engine.service.js';
import { NotificationService } from '../services/notification.service.js';
import { todayStr, toLocalHHMM } from '../utils/date.js';
import { env } from '../config/env.js';

export class SupplementController {
  /**
   * Log or toggle taking magnesium vitamin for a date.
   * POST /api/supplements/magnesium
   */
  static async logMagnesium(req, res, next) {
    try {
      const {
        date,
        taken = true,
        dosage = 'Magnesium Glycinate 400mg',
        notes = null,
        takenAt = null,
      } = req.body;

      const targetDate = date || todayStr();

      const result = await SupplementRepo.upsert({
        date: targetDate,
        supplement: 'magnesium',
        taken: Boolean(taken),
        taken_at: taken ? (takenAt ? new Date(takenAt) : new Date()) : null,
        dosage,
        notes,
      });

      const weeklyStats = await SupplementRepo.getWeeklyConsistency(targetDate, 'magnesium');

      return res.json({
        success: true,
        data: {
          ...result,
          taken: Boolean(result.taken),
          weeklyStats,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get magnesium log status and weekly consistency.
   * GET /api/supplements/magnesium?date=YYYY-MM-DD
   */
  static async getMagnesiumStatus(req, res, next) {
    try {
      const targetDate = req.query.date || todayStr();
      const log = await SupplementRepo.getByDate(targetDate, 'magnesium');
      const weeklyStats = await SupplementRepo.getWeeklyConsistency(targetDate, 'magnesium');
      const bedtimeLog = await BedtimeRepo.getByDate(targetDate);
      const wakeTime = bedtimeLog?.wake_time || null;

      let taken = log ? Boolean(log.taken) : false;
      let takenAt = log?.taken_at ? toLocalHHMM(log.taken_at) : null;
      let dosage = log?.dosage || null;
      let notes = log?.notes || null;

      // Reset check: if magnesium was logged before waking up today,
      // it belonged to the pre-wake sleep cycle. Once awake, the user has a fresh cycle for tonight!
      if (taken && log?.taken_at && wakeTime) {
        const takenMoment = moment(log.taken_at).tz(env.TIMEZONE);
        const [wH, wM] = wakeTime.split(':').map(Number);
        const wakeMoment = moment.tz(targetDate, 'YYYY-MM-DD', env.TIMEZONE).hour(wH).minute(wM).second(0);
        if (takenMoment.isBefore(wakeMoment)) {
          taken = false;
          takenAt = null;
          dosage = null;
          notes = null;
        }
      }

      return res.json({
        success: true,
        data: {
          date: targetDate,
          supplement: 'magnesium',
          taken,
          takenAt,
          dosage,
          notes,
          weeklyStats,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Trigger an immediate test/manual magnesium reminder push notification.
   * POST /api/supplements/magnesium/remind
   */
  static async sendMagnesiumReminder(req, res, next) {
    try {
      const now = moment().tz(env.TIMEZONE);
      const night = (now.hour() < 12 ? now.clone().subtract(1, 'day') : now).format('YYYY-MM-DD');
      const rec = await SleepEngineService.getRecommendation(night);
      const currentTimeStr = now.format('HH:mm');

      await NotificationService.sendBedtimeReminder({
        kind: 'magnesium',
        rec,
        currentTimeStr,
      });

      return res.json({
        success: true,
        message: `Magnesium reminder notification dispatched for bedtime ${rec.recommendedBedtime}`,
        data: {
          recommendedBedtime: rec.recommendedBedtime,
          magnesiumReminderTime: rec.magnesiumReminderTime,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}
