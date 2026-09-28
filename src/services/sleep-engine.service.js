import { env } from '../config/env.js';
import { BedtimeRepo } from '../repositories/bedtime.repo.js';
import { SleepPlanRepo } from '../repositories/sleep-plan.repo.js';
import { formatDateKey, formatDuration, shiftDate, todayStr } from '../utils/date.js';

const DAY_MINUTES = 1440;
const HALF_DAY_MINUTES = 720;

const HISTORY_DAYS = 14;
const RECENT_NIGHTS = 3;
const RECENCY_HALF_LIFE_NIGHTS = 4;
const OUTLIER_THRESHOLD_MINUTES = 120;

// Phase-advance pacing. Without bright light the clock advances only ~12 min/day, and ~30 min/day
// with morning bright light (Burgess 2003; Revell 2006); schedules that outrun it cause misalignment
// (Eastman 2005). Sleeping well ahead of the clock hits the wake maintenance zone (~1-4 h before
// habitual onset). So: 15-min steps, each held for 2 nights, never more than 30 min ahead of habit.
const ADVANCE_STEP_MINUTES = 15;
const CONSOLIDATION_NIGHTS = 2;
const MAX_LEAD_MINUTES = 30;
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
   * "bedtime" in history is the watch-detected sleep onset. The plan moves onset toward
   * BEDTIME_TARGET in ADVANCE_STEP_MINUTES steps, each held for CONSOLIDATION_NIGHTS nights on
   * target, never later than the habitual onset and never more than MAX_LEAD_MINUTES ahead of it.
   *
   * @param {Array<{ date: string, bedtime: string, wakeTime?: string, isWeekend?: boolean, sleepHours?: number, sleepNeedMins?: number }>} history
   *   Nights ordered oldest -> newest.
   * @param {{ date?: string, prev?: { targetOnset: string, status: string } | null }} [options]
   *   date: the plan's date; last night only counts as "last night" if it matches.
   *   prev: the plan that was shown for last night.
   */
  static recommend(history, options = {}) {
    const nights = (history || []).filter((n) => n.bedtime);

    if (nights.length === 0) {
      const goalOnset = SleepEngineService.timeToMinutesPastNoon(env.BEDTIME_TARGET);
      return SleepEngineService.buildPlan({
        anchorOnset: goalOnset,
        habitualWake: null,
        targetOnset: goalOnset,
        sleepNeedMins: SleepEngineService.resolveSleepNeed(nights),
        awakeAllowanceMins: 0,
        status: 'no_data',
        guidance: 'No sleep history recorded yet. Start tracking to calibrate your personalized circadian anchor.',
      });
    }

    const window = nights.slice(-HISTORY_DAYS);
    const prev = options.prev
      ? { targetOnset: SleepEngineService.timeToMinutesPastNoon(options.prev.targetOnset), status: options.prev.status }
      : null;
    const plan = SleepEngineService.planStep(window, prev, options.date);

    const sleepDebtMins = SleepEngineService.calculateSleepDebt(window, plan.sleepNeedMins);
    const socialJetlag = SleepEngineService.calculateSocialJetlag(window.filter((n) => n.wakeTime));
    const targetWake = plan.targetOnset + plan.sleepNeedMins + plan.awakeAllowanceMins;
    const shift = Math.round(plan.anchorOnset - plan.targetOnset);

    return SleepEngineService.buildPlan({
      ...plan,
      socialJetlag,
      sleepDebtMins,
      nightsAnalyzed: window.length,
      guidance: SleepEngineService.buildGuidance({
        status: plan.status,
        reason: plan.reason,
        step: plan.stepMinutes,
        shift,
        socialJetlag,
        onsetSdMins: plan.onsetSdMins,
        sleepDebtMins,
        targetWakeTime: SleepEngineService.minutesPastNoonToTime(targetWake),
      }),
    });
  }

  /**
   * Decides one night's target from the nights before it and the previous night's plan.
   *
   * @param {Array} nights - Nights before the planned one, oldest -> newest (non-empty)
   * @param {{ targetOnset: number, status: string } | null} prev - Plan that was in effect for the last night
   * @param {string} [date] - Date the plan is for
   */
  static planStep(nights, prev, date) {
    const toMins = SleepEngineService.timeToMinutesPastNoon;
    const sleepNeedMins = SleepEngineService.resolveSleepNeed(nights);

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
    const lastNightIsRecent = !date || lastNight.date === date;
    const lastNightDeficit = lastNightIsRecent && lastNight.sleepHours != null
      ? sleepNeedMins - lastNight.sleepHours * 60
      : 0;

    const onsetOnTrack = recentOnset <= anchorOnset + ON_TRACK_TOLERANCE_MINUTES;
    const wakeOnTrack = recentWake == null || recentWake <= habitualWake + WAKE_ON_TRACK_TOLERANCE_MINUTES;

    const lastOnset = unwrapNear(toMins(lastNight.bedtime), anchorOnset);
    const prevTarget = prev ? unwrapNear(prev.targetOnset, anchorOnset) : anchorOnset;
    const metLastTarget = !prev || lastOnset <= prevTarget + ON_TRACK_TOLERANCE_MINUTES;
    const earliestAllowed = Math.max(goalOnset, anchorOnset - MAX_LEAD_MINUTES);
    const currentLevel = Math.max(Math.min(anchorOnset, prevTarget), earliestAllowed);

    let status = 'holding';
    let reason = null;
    let targetOnset = currentLevel;

    if (minutesToGoal <= ON_TRACK_TOLERANCE_MINUTES) {
      status = 'achieved';
      targetOnset = Math.min(anchorOnset, goalOnset);
    } else if (!onsetOnTrack) {
      status = 'regressing';
      targetOnset = anchorOnset;
    } else if (lastNightDeficit >= SHORT_NIGHT_DEFICIT_MINUTES) {
      reason = 'short_night';
    } else if (!wakeOnTrack) {
      reason = 'late_wake';
    } else if (!metLastTarget) {
      reason = 'missed';
    } else if (prev?.status === 'advancing') {
      reason = 'consolidating';
    } else {
      const next = Math.max(currentLevel - ADVANCE_STEP_MINUTES, earliestAllowed);
      const finalStep = next === goalOnset && currentLevel > goalOnset;
      if (currentLevel - next >= ADVANCE_STEP_MINUTES / 2 || finalStep) {
        status = 'advancing';
        targetOnset = next;
      } else {
        reason = earliestAllowed > goalOnset ? 'lead_cap' : 'consolidating';
      }
    }

    return {
      anchorOnset,
      habitualWake,
      targetOnset,
      sleepNeedMins,
      awakeAllowanceMins,
      status,
      reason,
      stepMinutes: status === 'advancing' ? Math.round(currentLevel - targetOnset) : 0,
      onsetSdMins,
      outlierNights: outliers,
    };
  }

  static buildPlan({
    anchorOnset,
    habitualWake,
    targetOnset,
    sleepNeedMins,
    awakeAllowanceMins,
    status,
    reason = null,
    stepMinutes = 0,
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
      stepMinutes,
      socialJetlag,
      sleepNeedHours: Number((sleepNeedMins / 60).toFixed(1)),
      sleepDebtHours: Number((sleepDebtMins / 60).toFixed(1)),
      sleepNeedMins: Math.round(sleepNeedMins),
      sleepDebtMins: Math.round(sleepDebtMins),
      onsetVariabilityMins: onsetSdMins != null ? Math.round(onsetSdMins) : null,
      nightsAnalyzed,
      outlierNights,
      adherenceStatus: status,
      holdReason: reason,
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

  static buildGuidance({ status, reason, step, shift, socialJetlag, onsetSdMins, sleepDebtMins, targetWakeTime }) {
    const parts = [];

    if (status === 'advancing') {
      parts.push(`You held your target the last ${CONSOLIDATION_NIGHTS} nights, so tonight moves ${step} minutes earlier (${shift} minutes ahead of your usual time). Your body clock shifts only about 15-30 minutes a day, and only with morning light, so small steps keep falling asleep easy.`);
    } else if (status === 'holding' && reason === 'consolidating') {
      parts.push(`Tonight repeats last night's target. The next ${ADVANCE_STEP_MINUTES}-minute step comes after ${CONSOLIDATION_NIGHTS} nights on target, which gives your body clock time to catch up.`);
    } else if (status === 'holding' && reason === 'lead_cap') {
      parts.push(`Tonight holds: your target is already ${shift} minutes ahead of your usual time. Going further before your body clock catches up would put bedtime in its "wake maintenance zone", when falling asleep is hardest.`);
    } else if (status === 'holding' && reason === 'missed') {
      parts.push(`You fell asleep later than last night's target, so tonight repeats it rather than moving earlier. ${CONSOLIDATION_NIGHTS} nights on target unlock the next step.`);
    } else if (status === 'holding' && reason === 'late_wake') {
      parts.push('You have been waking later than usual, so tonight holds instead of moving earlier. Sleeping in keeps morning light away and pulls your body clock later; getting up on time is what unlocks the next step.');
    } else if (status === 'holding' && reason === 'short_night') {
      parts.push('Last night was short, so tonight holds instead of moving earlier. Avoid sleeping in or long naps; steady timing rebuilds sleep pressure for tonight.');
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
      parts.push(`You are carrying about ${formatDuration(sleepDebtMins * 60)} of sleep debt this week; protect your full sleep window tonight.`);
    }

    return parts.join(' ');
  }

  /**
   * Builds the plan for the night starting on `date` from the preceding 14 days of logs,
   * and records it so the next night's step knows tonight's target.
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

    // Nights are keyed by wake date, so the last logged night was planned the evening before it.
    const lastNight = history.filter((n) => n.bedtime).at(-1);
    const prevRow = lastNight ? await SleepPlanRepo.getByDate(shiftDate(lastNight.date, -1)) : null;
    const prev = prevRow ? { targetOnset: prevRow.target_onset, status: prevRow.status } : null;

    const rec = SleepEngineService.recommend(history, { date, prev });

    // Past dates are only re-derived for viewing; the stored plan is what was shown that evening.
    if (date >= shiftDate(todayStr(), -1) && rec.adherenceStatus !== 'no_data') {
      await SleepPlanRepo.upsert({
        date,
        targetOnset: rec.recommendedSleepOnset,
        status: rec.adherenceStatus,
        holdReason: rec.holdReason,
        stepMinutes: rec.stepMinutes,
      });
    }
    return rec;
  }
}
