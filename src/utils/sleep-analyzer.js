import { env } from '../config/env.js';

/**
 * Analyze rolling sleep data and produce an objective statistical summary for Mom's context.
 *
 * @param {Array<{ date: string, sleepHours: number|null, bedtimeHour?: number|null, sleepScore?: number|null }>} weekData
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

  const targetHour = parseInt(env.BEDTIME_TARGET.split(':')[0], 10);
  const avgHours = valid.reduce((sum, d) => sum + d.sleepHours, 0) / valid.length;

  // Late night detection (after target hour, e.g. after 00:00 or between 00:00 and 06:00)
  const lateCount = valid.filter((d) => {
    if (d.bedtimeHour == null) return false;
    // If target is 00:00, anything between 1 AM and 6 AM is definitely late
    if (targetHour === 0) {
      return d.bedtimeHour >= 1 && d.bedtimeHour < 12;
    }
    return d.bedtimeHour > targetHour || (d.bedtimeHour >= 0 && d.bedtimeHour < 6);
  }).length;

  const shortCount = valid.filter((d) => d.sleepHours < env.SLEEP_TARGET_HOURS).length;

  const sorted = [...valid].sort((a, b) => b.sleepHours - a.sleepHours);
  const best = sorted[0]?.date || null;
  const worst = sorted[sorted.length - 1]?.date || null;

  // Trend detection: compare earlier half with recent half
  const half = Math.ceil(valid.length / 2);
  const firstHalf = valid.slice(0, half).reduce((s, d) => s + d.sleepHours, 0) / half;
  const secondHalf = valid.slice(half).reduce((s, d) => s + d.sleepHours, 0) / (valid.length - half || 1);
  const trend = secondHalf > firstHalf + 0.3 ? 'improving' : secondHalf < firstHalf - 0.3 ? 'declining' : 'stable';

  const parts = [];
  parts.push(`Average sleep: ${avgHours.toFixed(1)} hrs/night over ${valid.length} days (Target: ${env.SLEEP_TARGET_HOURS}h)`);
  if (lateCount > 0) {
    parts.push(`${lateCount} out of ${valid.length} nights had a late bedtime past ${env.BEDTIME_TARGET}`);
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
