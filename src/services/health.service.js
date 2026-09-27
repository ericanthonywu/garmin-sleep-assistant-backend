import { WellnessRepo } from '../repositories/wellness.repo.js';
import { SleepRepo } from '../repositories/sleep.repo.js';
import { HeartRateRepo } from '../repositories/heartrate.repo.js';
import { WorkoutRepo } from '../repositories/workout.repo.js';
import { ReportRepo } from '../repositories/report.repo.js';
import { BedtimeRepo } from '../repositories/bedtime.repo.js';
import { IntervalsService } from './intervals.service.js';
import { SleepEngineService } from './sleep-engine.service.js';
import { isWeekend, daysAgo } from '../utils/date.js';

export class HealthService {
  /**
   * Pulls wellness and activity data from Intervals.icu and stores it in PostgreSQL.
   */
  static async syncFromIntervals(startDate, endDate) {
    const wellnessList = await IntervalsService.fetchWellness(startDate, endDate);
    let count = 0;

    for (const item of wellnessList) {
      if (!item.id) continue;
      await WellnessRepo.upsert({
        date: item.id,
        sleep_score: item.sleepScore != null ? Math.round(item.sleepScore) : null,
        sleep_secs: item.sleepSecs != null ? Math.round(item.sleepSecs) : null,
        resting_hr: item.restingHR != null ? Math.round(item.restingHR) : null,
        hrv: item.hrv != null ? Number(item.hrv) : null,
        vo2max: item.vo2max != null ? Number(item.vo2max) : null,
        body_battery_high: item.bodyBatteryHigh != null ? Math.round(item.bodyBatteryHigh) : null,
        body_battery_low: item.bodyBatteryLow != null ? Math.round(item.bodyBatteryLow) : null,
        steps_total: item.steps != null ? Math.round(item.steps) : null,
        raw_json: JSON.stringify(item),
      });
      count++;
    }

    // Also sync activities/workouts
    try {
      const activities = await IntervalsService.fetchActivities(startDate, endDate);
      for (const act of activities) {
        if (!act.id) continue;
        const actDate = act.start_date_local ? act.start_date_local.split('T')[0] : startDate;
        await WorkoutRepo.upsert({
          date: actDate,
          type: act.type || 'Workout',
          name: act.name || null,
          duration_secs: act.moving_time ? Math.round(act.moving_time) : null,
          distance_meters: act.distance ? Number(act.distance) : null,
          calories: act.calories ? Math.round(act.calories) : null,
          avg_hr: act.average_heartrate ? Math.round(act.average_heartrate) : null,
          max_hr: act.max_heartrate ? Math.round(act.max_heartrate) : null,
          source: 'intervals',
          external_id: `intervals_${act.id}`,
        });
      }
    } catch (err) {
      console.warn('[HealthService] Activities sync warning:', err.message);
    }

    return count;
  }

  /**
   * Process and store data pushed from Flutter's HealthKit reader.
   */
  static async storeHealthKitPayload({ date, sleepStages = [], heartRateSamples = [] }) {
    let stagesInserted = 0;
    let hrInserted = 0;

    if (sleepStages.length > 0) {
      stagesInserted = await SleepRepo.upsertStages(date, sleepStages);

      // Determine sleep window for bedtime logging
      const validSleep = sleepStages
        .filter((s) => s.stage !== 'awake')
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      if (validSleep.length > 0) {
        const firstSleep = validSleep[0];
        const lastSleep = validSleep[validSleep.length - 1];

        const bedtimeDate = new Date(firstSleep.startTime);
        const wakeDate = new Date(lastSleep.endTime);

        const bedtimeStr = `${String(bedtimeDate.getHours()).padStart(2, '0')}:${String(bedtimeDate.getMinutes()).padStart(2, '0')}`;
        const wakeStr = `${String(wakeDate.getHours()).padStart(2, '0')}:${String(wakeDate.getMinutes()).padStart(2, '0')}`;
        const totalDurationSecs = sleepStages
          .filter((s) => s.stage !== 'awake')
          .reduce((sum, s) => sum + (s.durationSecs || 0), 0);

        await BedtimeRepo.upsertLog({
          date,
          bedtime: bedtimeStr,
          wake_time: wakeStr,
          is_weekend: isWeekend(date),
          sleep_hours: totalDurationSecs / 3600,
        });
      }
    }

    if (heartRateSamples.length > 0) {
      hrInserted = await HeartRateRepo.upsertSamples(heartRateSamples);
    }

    return { stagesInserted, hrInserted };
  }

  /**
   * Builds the aggregated Dashboard model for the given date.
   */
  static async getDashboardData(date) {
    const [wellness, stages, workouts, morningReport, sleepRec, weekly] = await Promise.all([
      WellnessRepo.getByDate(date),
      SleepRepo.getByDate(date),
      WorkoutRepo.getByDate(date),
      ReportRepo.getByDate(date),
      SleepEngineService.getRecommendation(date),
      HealthService.getWeeklySleep(date),
    ]);

    // Calculate stage durations in minutes
    let deepMins = 0;
    let lightMins = 0;
    let remMins = 0;
    let awakeMins = 0;

    for (const s of stages) {
      const mins = (s.duration_secs || 0) / 60;
      if (s.stage === 'deep') deepMins += mins;
      else if (s.stage === 'light') lightMins += mins;
      else if (s.stage === 'rem') remMins += mins;
      else if (s.stage === 'awake') awakeMins += mins;
    }

    // Determine bedtime and wake time from stages
    const actualSleep = stages.filter((s) => s.stage !== 'awake');
    const bedtime = actualSleep.length > 0 ? actualSleep[0].start_time : null;
    const wakeTime = actualSleep.length > 0 ? actualSleep[actualSleep.length - 1].end_time : null;

    const sleepSecsFromStages = (deepMins + lightMins + remMins) * 60;
    const totalSleepSecs = wellness?.sleep_secs || (sleepSecsFromStages > 0 ? sleepSecsFromStages : null);
    const sleepHours = totalSleepSecs ? totalSleepSecs / 3600 : null;

    return {
      date,
      sleepScore: wellness?.sleep_score || null,
      sleepHours: sleepHours ? Number(sleepHours.toFixed(1)) : null,
      restingHR: wellness?.resting_hr || null,
      hrv: wellness?.hrv ? Math.round(wellness.hrv) : null,
      vo2max: wellness?.vo2max ? Number(wellness.vo2max.toFixed(1)) : null,
      bodyBatteryHigh: wellness?.body_battery_high || null,
      bodyBatteryLow: wellness?.body_battery_low || null,
      steps: wellness?.steps_total || null,
      deepSleepMins: Math.round(deepMins),
      lightSleepMins: Math.round(lightMins),
      remSleepMins: Math.round(remMins),
      awakeMins: Math.round(awakeMins),
      bedtime,
      wakeTime,
      workouts: workouts || [],
      sleepStages: stages || [],
      morningNote: morningReport?.content || null,
      morningVerdict: morningReport?.sleep_verdict || null,
      sleepEngineRecommendation: sleepRec,
      weeklyChart: weekly,
    };
  }

  /**
   * Retrieves 7-day sleep records ending on endDate for chart rendering.
   */
  static async getWeeklySleep(endDate) {
    const startDate = daysAgo(6);
    const [wellnessRows, bedtimeRows] = await Promise.all([
      WellnessRepo.getRange(startDate, endDate),
      BedtimeRepo.getRecentLogs(7),
    ]);

    const daysMap = new Map();

    for (let i = 6; i >= 0; i--) {
      const d = daysAgo(i);
      daysMap.set(d, {
        date: d,
        sleepHours: null,
        sleepScore: null,
        bedtime: null,
      });
    }

    for (const w of wellnessRows) {
      const dateKey = typeof w.date === 'string' ? w.date : w.date.toISOString().split('T')[0];
      if (daysMap.has(dateKey)) {
        const item = daysMap.get(dateKey);
        item.sleepScore = w.sleep_score || null;
        if (w.sleep_secs) item.sleepHours = Number((w.sleep_secs / 3600).toFixed(1));
      }
    }

    for (const b of bedtimeRows) {
      const dateKey = typeof b.date === 'string' ? b.date : b.date.toISOString().split('T')[0];
      if (daysMap.has(dateKey)) {
        const item = daysMap.get(dateKey);
        item.bedtime = b.bedtime || null;
        if (item.sleepHours == null && b.sleep_hours) {
          item.sleepHours = Number(b.sleep_hours.toFixed(1));
        }
      }
    }

    return Array.from(daysMap.values());
  }

  /**
   * Detailed sleep metrics for Sleep Detail screen including overnight HR samples.
   */
  static async getSleepDetail(date) {
    const dashData = await HealthService.getDashboardData(date);

    // Fetch overnight HR window: 10 PM previous night to 11 AM today
    const prevDate = daysAgo(1);
    const startIso = `${prevDate}T22:00:00`;
    const endIso = `${date}T11:00:00`;

    const hrSamples = await HeartRateRepo.getOvernight(startIso, endIso);

    return {
      ...dashData,
      overnightHR: hrSamples.map((s) => ({
        timestamp: s.timestamp,
        bpm: s.bpm,
      })),
    };
  }
}
