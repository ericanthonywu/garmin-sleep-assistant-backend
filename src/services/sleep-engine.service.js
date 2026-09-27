import { env } from '../config/env.js';
import { BedtimeRepo } from '../repositories/bedtime.repo.js';

export class SleepEngineService {
  /**
   * Convert HH:MM time string to minutes past noon (handles midnight wrap).
   * 12:00 PM = 0, 11:00 PM = 660, 00:00 = 720, 02:00 AM = 840
   */
  static timeToMinutesPastNoon(timeStr) {
    if (!timeStr) return 720;
    const parts = timeStr.split(':').map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const totalMinutes = h * 60 + m;
    return totalMinutes >= 720 ? totalMinutes - 720 : totalMinutes + 720;
  }

  /**
   * Convert minutes past noon back to HH:MM 24h string.
   */
  static minutesPastNoonToTime(mins) {
    const totalMinutes = ((Math.round(mins) % 1440) + 720) % 1440;
    const h = Math.floor(totalMinutes / 60);
    const m = Math.round(totalMinutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Calculate the circadian anchor bedtime using recency-weighted circular mean.
   * Circular statistics prevent the 23:45 + 00:45 = 12:15 PM arithmetic bug.
   *
   * @param {number[]} bedtimeMinutes - Array of minutes past noon
   */
  static calculateAnchorBedtime(bedtimeMinutes) {
    if (!bedtimeMinutes || bedtimeMinutes.length === 0) return null;

    // Exponential recency weights: recent nights count more
    const n = bedtimeMinutes.length;
    const weights = bedtimeMinutes.map((_, i) =>
      Math.exp(-0.5 + (0.5 * i / (n - 1 || 1)))
    );
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    // Circular mean via trigonometric representation
    const angles = bedtimeMinutes.map((m) => m * (2 * Math.PI / 1440));
    const sinSum = weights.reduce((sum, w, i) => sum + w * Math.sin(angles[i]), 0);
    const cosSum = weights.reduce((sum, w, i) => sum + w * Math.cos(angles[i]), 0);

    let meanAngle = Math.atan2(sinSum / totalWeight, cosSum / totalWeight);
    if (meanAngle < 0) meanAngle += 2 * Math.PI;

    return meanAngle * (1440 / (2 * Math.PI));
  }

  /**
   * Adaptive recommendation engine.
   *
   * @param {Array<{ date: string, bedtime: string, wakeTime?: string, isWeekend?: boolean, sleepHours?: number }>} history7d
   */
  static recommend(history7d) {
    if (!history7d || history7d.length === 0) {
      return {
        anchorBedtime: env.BEDTIME_TARGET,
        recommendedBedtime: env.BEDTIME_TARGET,
        windDownStart: SleepEngineService.minutesPastNoonToTime(
          SleepEngineService.timeToMinutesPastNoon(env.BEDTIME_TARGET) - 45
        ),
        shiftMinutes: 0,
        socialJetlag: 0,
        adherenceStatus: 'no_data',
        guidance: 'No sleep history yet. Start tracking and Mama will learn your natural rhythm!',
      };
    }

    const goalMinutes = SleepEngineService.timeToMinutesPastNoon(env.BEDTIME_TARGET);
    const bedtimeMinutes = history7d.map((d) => SleepEngineService.timeToMinutesPastNoon(d.bedtime));
    const anchorMinutes = SleepEngineService.calculateAnchorBedtime(bedtimeMinutes);

    // Social jetlag detection: difference between weekend and weekday averages
    const weekdayMins = history7d
      .filter((d) => !d.isWeekend)
      .map((d) => SleepEngineService.timeToMinutesPastNoon(d.bedtime));
    const weekendMins = history7d
      .filter((d) => d.isWeekend)
      .map((d) => SleepEngineService.timeToMinutesPastNoon(d.bedtime));

    const avgWeekday = weekdayMins.length > 0
      ? weekdayMins.reduce((a, b) => a + b, 0) / weekdayMins.length
      : anchorMinutes;
    const avgWeekend = weekendMins.length > 0
      ? weekendMins.reduce((a, b) => a + b, 0) / weekendMins.length
      : anchorMinutes;
    const socialJetlag = Math.round(avgWeekend - avgWeekday);

    // Recent adherence over the last 3 recorded nights
    const recent3 = history7d.slice(-3);
    const recentDrifts = recent3.map(
      (d) => SleepEngineService.timeToMinutesPastNoon(d.bedtime) - anchorMinutes
    );
    const avgDrift = recentDrifts.reduce((a, b) => a + b, 0) / (recentDrifts.length || 1);

    let step = 0;
    let adherenceStatus = 'holding';

    if (anchorMinutes > goalMinutes) {
      // User is currently sleeping later than desired goal -> need to phase advance
      const minutesToGoal = anchorMinutes - goalMinutes;

      if (avgDrift <= 10) {
        // User successfully fell asleep near or earlier than anchor -> safely advance by 15-20 min
        step = Math.min(20, minutesToGoal);
        adherenceStatus = 'advancing';
      } else if (avgDrift <= 30) {
        // User held near anchor -> hold steady
        step = 0;
        adherenceStatus = 'holding';
      } else {
        // User drifted later (>30 min) -> relax target by 10 min to prevent Wake Maintenance Zone insomnia
        step = -10;
        adherenceStatus = 'regressing';
      }
    } else {
      // User already meets or exceeds goal
      adherenceStatus = 'achieved';
    }

    let targetMinutes = anchorMinutes - step;

    // Hard safety limit: Never demand more than 45 min advance in a single jump
    targetMinutes = Math.max(targetMinutes, anchorMinutes - 45);

    // Wind-down window starts 45 minutes before recommended bedtime
    const windDownMinutes = targetMinutes - 45;

    const guidance = SleepEngineService.buildGuidance(
      adherenceStatus,
      step,
      socialJetlag,
      anchorMinutes,
      goalMinutes
    );

    return {
      anchorBedtime: SleepEngineService.minutesPastNoonToTime(anchorMinutes),
      recommendedBedtime: SleepEngineService.minutesPastNoonToTime(targetMinutes),
      windDownStart: SleepEngineService.minutesPastNoonToTime(windDownMinutes),
      shiftMinutes: Math.round(step),
      socialJetlag,
      adherenceStatus,
      guidance,
    };
  }

  static buildGuidance(status, shift, jetlag, anchor, goal) {
    const parts = [];

    if (status === 'advancing') {
      parts.push(`Stepping bedtime ${shift} minutes earlier tonight. Gradual 15-30 min shifts allow your circadian pacemaker to entrain sustainably without lying awake.`);
    } else if (status === 'holding') {
      parts.push(`Holding your current bedtime target. Consistent sleep timing for 3 consecutive nights locks in the circadian phase before advancing further.`);
    } else if (status === 'regressing') {
      parts.push(`You went to sleep later than your anchor. Temporarily adjusting target by 10 minutes to avoid trying to sleep during your peak alerting Wake Maintenance Zone.`);
    } else if (status === 'achieved') {
      parts.push(`You are hitting your target sleep window consistently! Keep this regular schedule, sayang. ❤️`);
    }

    if (Math.abs(jetlag) > 45) {
      parts.push(`Weekend social jetlag detected (${jetlag} min drift). Keeping weekend sleep within 45 minutes of weekdays prevents Monday morning lethargy.`);
    }

    parts.push(`Anchor with morning sunlight within 30 minutes of waking to reinforce tonight's melatonin timing.`);

    return parts.join(' ');
  }

  /**
   * Retrieves rolling history and generates recommendation for a specific date.
   */
  static async getRecommendation(date) {
    const rows = await BedtimeRepo.getRecentLogs(14);
    const history = rows.map((r) => ({
      date: r.date,
      bedtime: r.bedtime,
      wakeTime: r.wake_time,
      isWeekend: r.is_weekend,
      sleepHours: r.sleep_hours,
    }));

    return SleepEngineService.recommend(history);
  }
}
