import { WellnessRepo } from '../repositories/wellness.repo.js';
import { SleepRepo } from '../repositories/sleep.repo.js';
import { HeartRateRepo } from '../repositories/heartrate.repo.js';
import { WorkoutRepo } from '../repositories/workout.repo.js';
import { ReportRepo } from '../repositories/report.repo.js';
import { BedtimeRepo } from '../repositories/bedtime.repo.js';
import { IntervalsService } from './intervals.service.js';
import { SleepEngineService } from './sleep-engine.service.js';
import { isWeekend, formatDateKey, shiftDate, toLocalHHMM, formatDuration, localDateTimeIso } from '../utils/date.js';

// Garmin Connect is the source of truth for these; Intervals.icu only fills them when empty.
const GARMIN_PRIORITY_FIELDS = ['sleep_score', 'sleep_secs', 'resting_hr', 'hrv', 'raw_json'];

function formatDurationStr(secs) {
  return secs > 0 ? formatDuration(secs) : null;
}

/** Only the Garmin Connect sync fills sleep_need_mins and the stage columns. */
function isGarminNight(bedtimeLog, wellness) {
  return bedtimeLog?.sleep_need_mins != null || wellness?.deep_sleep_secs != null;
}

export class HealthService {
  /**
   * Pulls wellness and activity data from Intervals.icu and stores it in PostgreSQL.
   */
  static async syncFromIntervals(startDate, endDate) {
    const wellnessList = await IntervalsService.fetchWellness(startDate, endDate);
    let count = 0;

    for (const item of wellnessList) {
      if (!item.id) continue;
      const existing = await WellnessRepo.getByDate(item.id);
      const record = {
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
      };
      for (const field of GARMIN_PRIORITY_FIELDS) {
        if (existing?.[field] != null) delete record[field];
      }
      await WellnessRepo.upsert(record);
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
  static async storeHealthKitPayload({
    date,
    sleepStages = [],
    heartRateSamples = [],
    bedtime,
    wakeTime,
    sleepHours,
    sleepScore,
  }) {
    let stagesInserted = 0;
    let hrInserted = 0;

    const [existingLog, existingWellness] = await Promise.all([
      BedtimeRepo.getByDate(date),
      WellnessRepo.getByDate(date),
    ]);
    // Garmin Connect already recorded this night; HealthKit copies of it would only double up.
    const skipSleep = isGarminNight(existingLog, existingWellness);

    let totalDurationSecs = 0;
    if (!skipSleep && sleepStages.length > 0) {
      stagesInserted = await SleepRepo.replaceStages(date, sleepStages);

      // Determine sleep window for bedtime logging
      const validSleep = sleepStages
        .filter((s) => s.stage !== 'awake')
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      totalDurationSecs = validSleep.reduce((sum, s) => sum + (s.durationSecs || 0), 0);

      if (validSleep.length > 0) {
        const lastEnd = validSleep.reduce(
          (latest, s) => (new Date(s.endTime) > new Date(latest) ? s.endTime : latest),
          validSleep[0].endTime
        );

        await BedtimeRepo.upsertLog({
          date,
          bedtime: toLocalHHMM(bedtime || validSleep[0].startTime),
          wake_time: toLocalHHMM(wakeTime || lastEnd),
          is_weekend: isWeekend(date),
          sleep_hours: sleepHours != null ? sleepHours : totalDurationSecs / 3600,
        });
      }
    } else if (!skipSleep && bedtime && wakeTime) {
      await BedtimeRepo.upsertLog({
        date,
        bedtime: toLocalHHMM(bedtime),
        wake_time: toLocalHHMM(wakeTime),
        is_weekend: isWeekend(date),
        sleep_hours: sleepHours || null,
      });
    }

    if (!skipSleep && (sleepScore != null || sleepHours != null || totalDurationSecs > 0)) {
      const calculatedSecs = sleepHours ? Math.round(sleepHours * 3600) : (totalDurationSecs > 0 ? totalDurationSecs : null);
      await WellnessRepo.upsert({
        date,
        sleep_score: sleepScore != null ? Math.round(sleepScore) : (existingWellness?.sleep_score || null),
        sleep_secs: calculatedSecs || existingWellness?.sleep_secs || null,
      });
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
    const [wellness, stages, workouts, morningReport, sleepRec, weekly, bedtimeLog] = await Promise.all([
      WellnessRepo.getByDate(date),
      SleepRepo.getByDate(date),
      WorkoutRepo.getByDate(date),
      ReportRepo.getByDate(date),
      SleepEngineService.getRecommendation(date),
      HealthService.getWeeklySleep(date),
      BedtimeRepo.getByDate(date),
    ]);

    // Stage totals: prefer columns stored by Garmin Connect sync in daily_wellness.
    // Fall back to summing sleep_stages rows (for data pushed via HealthKit path).
    let deepMins = wellness?.deep_sleep_secs != null
      ? wellness.deep_sleep_secs / 60
      : 0;
    let lightMins = wellness?.light_sleep_secs != null
      ? wellness.light_sleep_secs / 60
      : 0;
    let remMins = wellness?.rem_sleep_secs != null
      ? wellness.rem_sleep_secs / 60
      : 0;
    let awakeMins = wellness?.awake_secs != null
      ? wellness.awake_secs / 60
      : 0;

    // If wellness columns are all null, fall back to summing sleep_stages rows
    if (deepMins === 0 && lightMins === 0 && remMins === 0 && stages.length > 0) {
      for (const s of stages) {
        const mins = (s.duration_secs || 0) / 60;
        if (s.stage === 'deep') deepMins += mins;
        else if (s.stage === 'light') lightMins += mins;
        else if (s.stage === 'rem') remMins += mins;
        else if (s.stage === 'awake') awakeMins += mins;
      }
    }

    // Determine bedtime and wake time from bedtimeLog (preferred local HH:mm) or stages
    const actualSleep = stages.filter((s) => s.stage !== 'awake');
    let bedtime = bedtimeLog?.bedtime || (actualSleep.length > 0 ? actualSleep[0].start_time : null);
    let wakeTime = bedtimeLog?.wake_time || (actualSleep.length > 0 ? actualSleep[actualSleep.length - 1].end_time : null);

    const sleepSecsFromStages = (deepMins + lightMins + remMins) * 60;
    const totalSleepSecs = wellness?.sleep_secs || (sleepSecsFromStages > 0 ? sleepSecsFromStages : (bedtimeLog?.sleep_hours ? bedtimeLog.sleep_hours * 3600 : null));
    const sleepHours = totalSleepSecs ? totalSleepSecs / 3600 : null;

    return {
      date,
      sleepScore: wellness?.sleep_score || null,
      sleepHours: sleepHours ? Number(sleepHours.toFixed(2)) : null,
      sleepSecs: totalSleepSecs ? Math.round(totalSleepSecs) : null,
      sleepFormatted: formatDurationStr(totalSleepSecs),
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
      sleepStages: stages || [],  // per-interval hypnogram data (empty unless pushed via HealthKit)
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
    const startDate = shiftDate(endDate, -6);
    const [wellnessRows, bedtimeRows] = await Promise.all([
      WellnessRepo.getRange(startDate, endDate),
      BedtimeRepo.getRange(startDate, endDate),
    ]);

    const daysMap = new Map();

    for (let i = 6; i >= 0; i--) {
      const d = shiftDate(endDate, -i);
      daysMap.set(d, {
        date: d,
        sleepHours: null,
        sleepSecs: null,
        sleepFormatted: null,
        sleepScore: null,
        bedtime: null,
        wakeTime: null,
      });
    }

    for (const w of wellnessRows) {
      const dateKey = formatDateKey(w.date);
      if (daysMap.has(dateKey)) {
        const item = daysMap.get(dateKey);
        item.sleepScore = w.sleep_score || null;
        if (w.sleep_secs) {
          item.sleepSecs = w.sleep_secs;
          item.sleepHours = Number((w.sleep_secs / 3600).toFixed(2));
          item.sleepFormatted = formatDurationStr(w.sleep_secs);
        }
      }
    }

    for (const b of bedtimeRows) {
      const dateKey = formatDateKey(b.date);
      if (daysMap.has(dateKey)) {
        const item = daysMap.get(dateKey);
        item.bedtime = b.bedtime || null;
        item.wakeTime = b.wake_time || null;
        if (item.sleepHours == null && b.sleep_hours) {
          item.sleepHours = Number(b.sleep_hours.toFixed(2));
          item.sleepSecs = Math.round(b.sleep_hours * 3600);
          item.sleepFormatted = formatDurationStr(item.sleepSecs);
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

    // Fetch overnight HR window: 4 PM previous night to 9 PM today
    const prevDate = shiftDate(date, -1);
    const startIso = localDateTimeIso(prevDate, '16:00');
    const endIso = localDateTimeIso(date, '21:00');

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
