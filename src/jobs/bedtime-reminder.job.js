import cron from 'node-cron';
import { SleepEngineService } from '../services/sleep-engine.service.js';
import { NotificationService } from '../services/notification.service.js';
import { todayStr } from '../utils/date.js';
import { env } from '../config/env.js';

let lastReminderTimestamp = 0;

/**
 * Checks every 10 minutes if current time is in the bedtime window:
 * From 30 minutes before the latest cutoff until 3:00 AM.
 * Keeps dispatching prominent, silent push reminders every ~15 minutes
 * until the user goes to sleep (or 3:00 AM cutoff).
 */
export function startBedtimeReminderJob() {
  cron.schedule('*/10 * * * *', async () => {
    try {
      const today = todayStr();
      const rec = await SleepEngineService.getRecommendation(today);
      if (!rec || !rec.latestBedtimeCutoff) {
        return;
      }

      // Current time in user timezone
      const now = new Date();
      const nowFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: env.TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const parts = nowFormatter.formatToParts(now);
      const currentHour = parseInt(parts.find((p) => p.type === 'hour').value, 10);
      const currentMinute = parseInt(parts.find((p) => p.type === 'minute').value, 10);
      const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

      const currentMinsPastNoon = SleepEngineService.timeToMinutesPastNoon(currentTimeStr);
      const cutoffMinsPastNoon = SleepEngineService.timeToMinutesPastNoon(rec.latestBedtimeCutoff);

      // Window starts 30 minutes before cutoff
      const windowStart = cutoffMinsPastNoon - 30;
      // Window ends strictly at 3:00 AM (03:00 = 900 minutes past noon)
      const windowEnd = 900;

      // Are we inside the active reminder window?
      const isInWindow = (currentMinsPastNoon >= windowStart && currentMinsPastNoon <= windowEnd);

      if (!isInWindow) {
        return;
      }

      // Throttle: ensure at least 14 minutes have passed since last push
      const nowMs = Date.now();
      if (nowMs - lastReminderTimestamp < 14 * 60 * 1000) {
        return;
      }

      // Determine urgency phase
      let urgency = 'winddown';
      if (currentMinsPastNoon >= 840) { // >= 2:00 AM
        urgency = 'critical';
      } else if (currentMinsPastNoon >= cutoffMinsPastNoon + 15) { // 15+ mins past cutoff
        urgency = 'late';
      } else if (currentMinsPastNoon >= cutoffMinsPastNoon - 10) { // right at cutoff
        urgency = 'cutoff';
      }

      console.log(`[bedtime-reminder] Sending reminder: Urgency=${urgency}, Current=${currentTimeStr}, Cutoff=${rec.latestBedtimeCutoff}`);

      await NotificationService.sendBedtimeReminder({
        recommendedBedtime: rec.recommendedBedtime,
        latestCutoff: rec.latestBedtimeCutoff,
        targetWakeTime: rec.targetWakeTime,
        urgency,
        currentTimeStr,
      });

      lastReminderTimestamp = nowMs;
    } catch (err) {
      console.error('[bedtime-reminder] Error checking bedtime reminder schedule:', err.message);
    }
  }, {
    timezone: env.TIMEZONE,
  });

  console.log(`⏰ Bedtime reminder job active: repeating silent notifications until 3:00 AM (${env.TIMEZONE})`);
}
