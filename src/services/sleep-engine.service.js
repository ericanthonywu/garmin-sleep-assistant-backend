import { env } from '../config/env.js';
import { BedtimeRepo } from '../repositories/bedtime.repo.js';
import { formatDateKey, shiftDate, todayStr } from '../utils/date.js';

const DAY_MINUTES = 1440;
const HALF_DAY_MINUTES = 720;

const HISTORY_DAYS = 14;
const RECENT_NIGHTS = 3;
const RECENCY_HALF_LIFE_NIGHTS = 4;
const OUTLIER_THRESHOLD_MINUTES = 120;

const ADVANCE_STEP_MINUTES = 20;
const ON_TRACK_TOLERANCE_MINUTES = 15;
const WAKE_ON_TRACK_TOLERANCE_MINUTES = 30;
const SHORT_NIGHT_DEFICIT_MINUTES = 90;
const MAX_AWAKE_ALLOWANCE_MINUTES = 60;

const CUTOFF_AFTER_BEDTIME_MINUTES = 45;
const WIND_DOWN_BEFORE_BEDTIME_MINUTES = 60;
const DIM_LIGHTS_BEFORE_BEDTIME_MINUTES = 120;

const SLEEP_DEBT_WINDOW_NIGHTS = 7;
const SOCIAL_JETLAG_ALERT_MINUTES = 60;
const IRREGULAR_ONSET_SD_MINUTES = 60;
const SLEEP_DEBT_ALERT_MINUTES = 300;

/** Signed shortest distance a - b on the 24h clock, in (-720, 720]. */
function circularDiff(a, b) {
  return ((((a - b) % DAY_MINUTES) + DAY_MINUTES + HALF_DAY_MINUTES) % DAY_MINUTES) - HALF_DAY_MINUTES;
}

/** Re-expresses a clock value as the linear value closest to ref, so plain arithmetic is safe. */
function unwrapNear(value, ref) {
  return ref + circularDiff(value, ref);
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function weightedCircularMean(values, weights = values.map(() => 1)) {
  let sinSum = 0;
  let cosSum = 0;
  let totalWeight = 0;
  values.forEach((v, i) => {
    const angle = (v * 2 * Math.PI) / DAY_MINUTES;
    sinSum += weights[i] * Math.sin(angle);
    cosSum += weights[i] * Math.cos(angle);
    totalWeight += weights[i];
  });

  let meanAngle = Math.atan2(sinSum, cosSum);
  if (meanAngle < 0) meanAngle += 2 * Math.PI;

  return {
    mean: (meanAngle * DAY_MINUTES) / (2 * Math.PI),
    resultant: Math.hypot(sinSum, cosSum) / totalWeight,
  };
}

function circularSdMinutes(resultant) {
  if (resultant >= 1) return 0;
  return (Math.sqrt(-2 * Math.log(resultant)) * DAY_MINUTES) / (2 * Math.PI);
}

function circularMedian(values) {
  let best = values[0];
  let bestCost = Infinity;
  for (const candidate of values) {
    const cost = values.reduce((sum, v) => sum + Math.abs(circularDiff(v, candidate)), 0);
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * Recency-weighted circular mean after discarding nights far from the circular median,
 * so a single all-nighter or party night does not drag the habitual time.
 *
 * @param {number[]} values - Clock values in minutes, ordered oldest -> newest
 */
function robustCircularCenter(values) {
  if (!values || values.length === 0) return null;

  const med = circularMedian(values);
  const n = values.length;
  const kept = [];
  const weights = [];
  values.forEach((v, i) => {
    if (Math.abs(circularDiff(v, med)) <= OUTLIER_THRESHOLD_MINUTES) {
      kept.push(v);
      weights.push(0.5 ** ((n - 1 - i) / RECENCY_HALF_LIFE_NIGHTS));
    }
  });

  return {
    center: weightedCircularMean(kept, weights).mean,
    outliers: n - kept.length,
  };
}

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
   * Convert minutes past noon back to HH:MM 24h string. Accepts any (including negative) value.
   */
  static minutesPastNoonToTime(mins) {
    const totalMinutes = ((Math.round(mins) % 1440) + 1440 + 720) % 1440;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  static circularDiff(a, b) {
    return circularDiff(a, b);
  }

  /**
   * Habitual (anchor) sleep onset: outlier-trimmed, recency-weighted circular mean.
   *
   * @param {number[]} bedtimeMinutes - Minutes past noon, ordered oldest -> newest
   */
  static calculateAnchorBedtime(bedtimeMinutes) {
    return robustCircularCenter(bedtimeMinutes)?.center ?? null;
  }

  /**
   * Adaptive recommendation engine.
   *
   * "bedtime" in history is the watch-detected sleep onset. The plan advances onset toward
   * BEDTIME_TARGET in small steps only after recent nights stayed on track, never recommends
   * later than the habitual onset, and derives the wake anchor from personal sleep need.
   *
   * @param {Array<{ date: string, bedtime: string, wakeTime?: string, isWeekend?: boolean, sleepHours?: number, sleepNeedMins?: number }>} history
   *   Nights ordered oldest -> newest.
   * @param {{ date?: string }} [options] - Date the plan is for; last night only counts as "last night" if it matches.
   */
  static recommend(history, options = {}) {
    const nights = (history || []).filter((n) => n.bedtime);
    const sleepNeedMins = SleepEngineService.resolveSleepNeed(nights);
    const toMins = SleepEngineService.timeToMinutesPastNoon;

    if (nights.length === 0) {
      const goalOnset = toMins(env.BEDTIME_TARGET);
      return SleepEngineService.buildPlan({
        anchorOnset: goalOnset,
        habitualWake: null,
        targetOnset: goalOnset,
        sleepNeedMins,
        awakeAllowanceMins: 0,
        status: 'no_data',
        guidance: 'No sleep history recorded yet. Start tracking to calibrate your personalized circadian anchor.',
      });
    }

    const onsets = nights.map((n) => toMins(n.bedtime));
    const { center: anchorOnset, outliers } = robustCircularCenter(onsets);
    const onsetSdMins = circularSdMinutes(weightedCircularMean(onsets).resultant);

    const nightsWithWake = nights.filter((n) => n.wakeTime);
    const awakeAllowanceMins = SleepEngineService.resolveAwakeAllowance(nightsWithWake);
    const expectedWake = anchorOnset + sleepNeedMins + awakeAllowanceMins;
    const habitualWake = nightsWithWake.length > 0
      ? unwrapNear(robustCircularCenter(nightsWithWake.map((n) => toMins(n.wakeTime))).center, expectedWake)
      : null;

    const goalOnset = unwrapNear(toMins(env.BEDTIME_TARGET), anchorOnset);
    const minutesToGoal = anchorOnset - goalOnset;

    const recent = nights.slice(-RECENT_NIGHTS);
    const recentOnset = median(recent.map((n) => unwrapNear(toMins(n.bedtime), anchorOnset)));
    const recentWakes = recent
      .filter((n) => n.wakeTime && habitualWake != null)
      .map((n) => unwrapNear(toMins(n.wakeTime), habitualWake));
    const recentWake = recentWakes.length > 0 ? median(recentWakes) : null;

    const lastNight = nights[nights.length - 1];
    const lastNightIsRecent = !options.date || lastNight.date === options.date;
    const lastNightDeficit = lastNightIsRecent && lastNight.sleepHours != null
      ? sleepNeedMins - lastNight.sleepHours * 60
      : 0;

    const onsetOnTrack = recentOnset <= anchorOnset + ON_TRACK_TOLERANCE_MINUTES;
    const wakeOnTrack = recentWake == null || recentWake <= habitualWake + WAKE_ON_TRACK_TOLERANCE_MINUTES;

    let status;
    let reason = null;
    let targetOnset = anchorOnset;

    if (minutesToGoal <= ON_TRACK_TOLERANCE_MINUTES) {
      status = 'achieved';
      targetOnset = Math.min(anchorOnset, goalOnset);
    } else if (lastNightDeficit >= SHORT_NIGHT_DEFICIT_MINUTES) {
      status = 'holding';
      reason = 'short_night';
    } else if (onsetOnTrack && wakeOnTrack) {
      status = 'advancing';
      targetOnset = anchorOnset - Math.min(ADVANCE_STEP_MINUTES, minutesToGoal);
    } else {
      status = 'regressing';
    }

    const sleepDebtMins = SleepEngineService.calculateSleepDebt(nights, sleepNeedMins);
    const socialJetlag = SleepEngineService.calculateSocialJetlag(nightsWithWake);
    const targetWake = targetOnset + sleepNeedMins + awakeAllowanceMins;

    return SleepEngineService.buildPlan({
      anchorOnset,
      habitualWake,
      targetOnset,
      sleepNeedMins,
      awakeAllowanceMins,
      status,
      socialJetlag,
      sleepDebtMins,
      onsetSdMins,
      nightsAnalyzed: nights.length,
      outlierNights: outliers,
      guidance: SleepEngineService.buildGuidance({
        status,
        reason,
        shift: Math.round(anchorOnset - targetOnset),
        socialJetlag,
        onsetSdMins,
        sleepDebtMins,
        targetWakeTime: SleepEngineService.minutesPastNoonToTime(targetWake),
      }),
    });
  }

  static buildPlan({
    anchorOnset,
    habitualWake,
    targetOnset,
    sleepNeedMins,
    awakeAllowanceMins,
    status,
    socialJetlag = 0,
    sleepDebtMins = 0,
    onsetSdMins = null,
    nightsAnalyzed = 0,
    outlierNights = 0,
    guidance,
  }) {
    const toTime = SleepEngineService.minutesPastNoonToTime;
    const bedtime = targetOnset - env.SLEEP_LATENCY_MINUTES;
    const targetWake = targetOnset + sleepNeedMins + awakeAllowanceMins;

    return {
      anchorBedtime: toTime(anchorOnset),
      habitualWakeTime: habitualWake != null ? toTime(habitualWake) : null,
      recommendedBedtime: toTime(bedtime),
      recommendedSleepOnset: toTime(targetOnset),
      latestBedtimeCutoff: toTime(bedtime + CUTOFF_AFTER_BEDTIME_MINUTES),
      targetWakeTime: toTime(targetWake),
      dimLightsStart: toTime(bedtime - DIM_LIGHTS_BEFORE_BEDTIME_MINUTES),
      windDownStart: toTime(bedtime - WIND_DOWN_BEFORE_BEDTIME_MINUTES),
      shiftMinutes: Math.round(anchorOnset - targetOnset),
      socialJetlag,
      sleepNeedHours: Number((sleepNeedMins / 60).toFixed(1)),
      sleepDebtHours: Number((sleepDebtMins / 60).toFixed(1)),
      onsetVariabilityMins: onsetSdMins != null ? Math.round(onsetSdMins) : null,
      nightsAnalyzed,
      outlierNights,
      adherenceStatus: status,
      guidance,
    };
  }

  /** Median Garmin-estimated sleep need, falling back to SLEEP_TARGET_HOURS. */
  static resolveSleepNeed(nights) {
    const needs = nights.map((n) => n.sleepNeedMins).filter((v) => v > 0);
    return needs.length > 0 ? median(needs) : Math.round(env.SLEEP_TARGET_HOURS * 60);
  }

  /** Typical minutes awake between sleep onset and final wake (time in bed not counted as sleep). */
  static resolveAwakeAllowance(nightsWithWake) {
    const toMins = SleepEngineService.timeToMinutesPastNoon;
    const awake = nightsWithWake
      .filter((n) => n.sleepHours != null)
      .map((n) => {
        const onsetToWake = ((toMins(n.wakeTime) - toMins(n.bedtime)) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
        return onsetToWake - n.sleepHours * 60;
      });
    if (awake.length === 0) return 0;
    return Math.round(Math.min(MAX_AWAKE_ALLOWANCE_MINUTES, Math.max(0, median(awake))));
  }

  /** Net sleep debt over the most recent nights (surplus nights pay debt back). */
  static calculateSleepDebt(nights, sleepNeedMins) {
    const net = nights
      .slice(-SLEEP_DEBT_WINDOW_NIGHTS)
      .filter((n) => n.sleepHours != null)
      .reduce((sum, n) => sum + (sleepNeedMins - n.sleepHours * 60), 0);
    return Math.max(0, net);
  }

  /**
   * Social jetlag = mid-sleep on free days minus mid-sleep on work days (minutes, positive = later on free days).
   * Nights are labelled by wake date, so a "weekend" night is one before a free day.
   */
  static calculateSocialJetlag(nightsWithWake) {
    const toMins = SleepEngineService.timeToMinutesPastNoon;
    const midSleep = (n) => {
      const onset = toMins(n.bedtime);
      const duration = ((toMins(n.wakeTime) - onset) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
      return onset + duration / 2;
    };

    const free = nightsWithWake.filter((n) => n.isWeekend).map(midSleep);
    const work = nightsWithWake.filter((n) => !n.isWeekend).map(midSleep);
    if (free.length === 0 || work.length === 0) return 0;

    return Math.round(circularDiff(weightedCircularMean(free).mean, weightedCircularMean(work).mean));
  }

  static buildGuidance({ status, reason, shift, socialJetlag, onsetSdMins, sleepDebtMins, targetWakeTime }) {
    const parts = [];

    if (status === 'advancing') {
      parts.push(`Your recent nights stayed on track, so tonight's target is ${shift} minutes earlier. Small 15-20 minute steps let your body clock shift without lying awake.`);
    } else if (status === 'holding' && reason === 'short_night') {
      parts.push('Last night was short, so tonight holds at your usual time instead of moving earlier. Avoid sleeping in or long naps; steady timing rebuilds sleep pressure for tonight.');
    } else if (status === 'regressing') {
      parts.push('Your last few nights ran later than your usual time, so tonight holds at your usual time rather than moving earlier. Hitting it a few nights in a row unlocks the next step.');
    } else if (status === 'achieved') {
      parts.push('You are consistently falling asleep near your goal. Keep this schedule steady for optimal recovery.');
    }

    parts.push(`Wake at ${targetWakeTime} and get outdoor light within 30 minutes; a steady wake time is what anchors your body clock.`);

    if (Math.abs(socialJetlag) >= SOCIAL_JETLAG_ALERT_MINUTES) {
      const direction = socialJetlag > 0 ? 'later' : 'earlier';
      parts.push(`Your mid-sleep on weekends runs ${Math.abs(socialJetlag)} minutes ${direction} than on weekdays (social jetlag). Keep weekend wake within an hour of weekdays.`);
    }

    if (onsetSdMins != null && onsetSdMins >= IRREGULAR_ONSET_SD_MINUTES) {
      parts.push(`Your sleep onset varies by about ${Math.round(onsetSdMins)} minutes night to night; regular timing matters as much as the time itself.`);
    }

    if (sleepDebtMins >= SLEEP_DEBT_ALERT_MINUTES) {
      parts.push(`You are carrying about ${(sleepDebtMins / 60).toFixed(1)}h of sleep debt this week; protect your full sleep window tonight.`);
    }

    return parts.join(' ');
  }

  /**
   * Builds the plan for the night starting on `date` from the preceding 14 days of logs.
   */
  static async getRecommendation(date = todayStr()) {
    const startDate = shiftDate(date, -(HISTORY_DAYS - 1));
    const rows = await BedtimeRepo.getRange(startDate, date);
    const history = rows.map((r) => ({
      date: formatDateKey(r.date),
      bedtime: r.bedtime,
      wakeTime: r.wake_time,
      isWeekend: r.is_weekend,
      sleepHours: r.sleep_hours,
      sleepNeedMins: r.sleep_need_mins,
    }));

    return SleepEngineService.recommend(history, { date });
  }
}
