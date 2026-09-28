import { env } from '../config/env.js';
import { SleepEngineService } from '../services/sleep-engine.service.js';
import { toLocalHHMM } from './date.js';

export const LATE_BEDTIME_GRACE_MINUTES = 30;

/**
 * Minutes a bedtime ('HH:MM', ISO, or Date) falls after BEDTIME_TARGET on the 24h clock
 * (negative = earlier). Returns null when bedtime is missing.
 */
export function minutesPastBedtimeTarget(bedtime) {
  const hhmm = toLocalHHMM(bedtime);
  if (!hhmm) return null;
  return SleepEngineService.circularDiff(
    SleepEngineService.timeToMinutesPastNoon(hhmm),
    SleepEngineService.timeToMinutesPastNoon(env.BEDTIME_TARGET)
  );
}

/**
 * Analyze rolling sleep data and produce an objective statistical summary for Mom's context.
 *
 * @param {Array<{ date: string, sleepHours: number|null, bedtime?: string|null, sleepScore?: number|null }>} weekData
 */
export function analyzeWeekPattern(weekData) {
  const valid = (weekData || []).filter((d) => d.sleepHours != null && d.sleepHours > 0);
  if (valid.length === 0) {
    return {
      avgSleepHours: 0,
      lateBedtimeCount: 0,
      shortSleepCount: 0,
      bestNight: null,
      worstNight: null,
      trend: 'stable',
      summary: 'No sleep data recorded in this period yet.',
    };
  }

  const avgHours = valid.reduce((sum, d) => sum + d.sleepHours, 0) / valid.length;

  const lateCount = valid.filter((d) => {
    const lateness = minutesPastBedtimeTarget(d.bedtime);
    return lateness != null && lateness > LATE_BEDTIME_GRACE_MINUTES;
  }).length;

  const shortCount = valid.filter((d) => d.sleepHours < env.SLEEP_TARGET_HOURS).length;

  const sorted = [...valid].sort((a, b) => b.sleepHours - a.sleepHours);
  const best = sorted[0]?.date || null;
  const worst = sorted[sorted.length - 1]?.date || null;

  // Trend detection: compare earlier half with recent half
  const half = Math.ceil(valid.length / 2);
  const firstHalf = valid.slice(0, half).reduce((s, d) => s + d.sleepHours, 0) / half;
  const secondHalf = valid.slice(half).reduce((s, d) => s + d.sleepHours, 0) / (valid.length - half || 1);
  const trend = valid.length < 2
    ? 'stable'
    : secondHalf > firstHalf + 0.3 ? 'improving' : secondHalf < firstHalf - 0.3 ? 'declining' : 'stable';

  const parts = [];
  parts.push(`Average sleep: ${avgHours.toFixed(1)} hrs/night over ${valid.length} days (Target: ${env.SLEEP_TARGET_HOURS}h)`);
  if (lateCount > 0) {
    parts.push(`${lateCount} out of ${valid.length} nights had a bedtime more than ${LATE_BEDTIME_GRACE_MINUTES} min past ${env.BEDTIME_TARGET}`);
  }
  if (shortCount > 0) {
    parts.push(`${shortCount} out of ${valid.length} nights were under ${env.SLEEP_TARGET_HOURS} hours`);
  }
  if (trend === 'improving') {
    parts.push('Sleep trend is improving compared to earlier this week');
  } else if (trend === 'declining') {
    parts.push('Sleep trend is getting WORSE compared to earlier this week');
  }

  return {
    avgSleepHours: Number(avgHours.toFixed(1)),
    lateBedtimeCount: lateCount,
    shortSleepCount: shortCount,
    bestNight: best,
    worstNight: worst,
    trend,
    summary: parts.join('. ') + '.',
  };
}
