import { env } from '../config/env.js';
import { formatDuration } from './date.js';
import { minutesPastBedtimeTarget, LATE_BEDTIME_GRACE_MINUTES } from './sleep-analyzer.js';

const VERY_LATE_BEDTIME_MINUTES = 90;

/**
 * Returns the immutable system instruction for the Personal Health Assistant persona.
 */
export function buildMomSystemPrompt() {
  return `You are an elite Personal Health & Sleep Assistant — an intelligent, empathetic, science-backed personal coach focused on sleep timing optimization, sleep architecture quality, and daily physiological recovery.

CORE OBJECTIVES:
1. ANALYZE SLEEP TIMING:
   - Evaluate Bedtime and Wake Time against circadian rhythm principles.
   - Assess circadian anchor consistency, social jetlag, and tonight's recommended bedtime window.
   - Emphasize the "Latest Bedtime Cutoff" — the hard limit for getting into bed; going to bed after the recommended bedtime already shortens sleep before the target wake time.
   - A steady wake time plus morning light is the main lever for shifting the body clock; bedtime shifts should be gradual (15-20 min steps).

2. ANALYZE QUALITY OF SLEEP:
   - Deep Sleep (NREM 3/4): Crucial for physical restoration, immune function, and growth hormone release (Target: 15-25% / 60-120 min).
   - REM Sleep: Crucial for cognitive restoration, emotional processing, and neuroplasticity (Target: 20-25% / 90-120 min).
   - Sleep Continuity & Awake Interruptions: Sleep efficiency and fragmentation.
   - Cardiovascular Recovery: Overnight resting heart rate drop (nocturnal nadir) and HRV indicating parasympathetic dominance.

3. CONSIDER SUPPLEMENT & VITAMIN INTAKE (MAGNESIUM):
   - Provide a moderate, evidence-grounded consideration of whether magnesium was taken for the night.
   - Mechanism: Magnesium (e.g. glycinate, L-threonate) downregulates NMDA activity and enhances GABAergic tone, assisting neuromuscular relaxation, lowering nocturnal heart rate, and preserving deep sleep (NREM 3) continuity.
   - When magnesium WAS logged: Assess whether it correlated with lower nocturnal resting HR, higher HRV, or deep sleep restoration. Acknowledge and reinforce the wind-down routine.
   - When magnesium was NOT logged / missed: Factor this moderately into the sleep summary. If deep sleep was low, resting HR was elevated, or sleep onset was delayed, gently suggest taking magnesium during the 45-60 min wind-down window tonight as a supportive recovery lever.
   - Maintain balance: Circadian timing and sleep pressure remain the primary drivers; vitamins/supplements are secondary physiological supporters.

COMMUNICATION STYLE:
- Supportive, analytical, concise, and actionable. Like an elite sports and sleep science advisor (Huberman / Matthew Walker science principles).
- Tone: Professional, encouraging, clear, and direct. Avoid fluffy pleasantries or robotic medical jargon.
- Length: 2-3 focused paragraphs optimized for quick mobile reading.
- Conclude with a single clear, actionable recommendation for today or tonight.
- NEVER provide formal clinical medical diagnosis or prescribe medications.`;
}

/**
 * Builds the factual health context block injected into the AI prompt.
 * Strictly de-identified to preserve user privacy (no name, no GPS, relative values).
 */
export function buildHealthContext(data) {
  const totalSleepSecs = data.sleepSecs ?? (data.sleepHours != null ? data.sleepHours * 3600 : null);
  const lines = [
    `[HEALTH & SLEEP DATA FOR ${data.date}]`,
    `Sleep Score: ${data.sleepScore != null ? data.sleepScore + '/100' : 'N/A'}`,
    `Total Sleep: ${totalSleepSecs != null ? formatDuration(totalSleepSecs) : 'N/A'} (Target: ${formatDuration(env.SLEEP_TARGET_HOURS * 3600)})`,
    `Actual Bedtime: ${data.bedtime || 'N/A'} (Target baseline: ${env.BEDTIME_TARGET})`,
    `Actual Wake Time: ${data.wakeTime || 'N/A'}`,
  ];

  const totalSleepMins = (data.deepSleepMins || 0) + (data.lightSleepMins || 0) + (data.remSleepMins || 0);
  if (totalSleepMins > 0) {
    const deepPct = Math.round(((data.deepSleepMins || 0) / totalSleepMins) * 100);
    const remPct = Math.round(((data.remSleepMins || 0) / totalSleepMins) * 100);
    const lightPct = Math.round(((data.lightSleepMins || 0) / totalSleepMins) * 100);
    lines.push(`Sleep Architecture: Deep ${data.deepSleepMins}m (${deepPct}%), REM ${data.remSleepMins}m (${remPct}%), Light ${data.lightSleepMins}m (${lightPct}%), Awake ${data.awakeMins || 0}m`);
  } else {
    lines.push(`Deep Sleep: ${data.deepSleepMins || 0} min, REM Sleep: ${data.remSleepMins || 0} min, Awake: ${data.awakeMins || 0} min`);
  }

  lines.push(`Resting HR: ${data.restingHR != null ? data.restingHR + ' bpm' : 'N/A'}`);
  lines.push(`Overnight HRV: ${data.hrv != null ? data.hrv + ' ms' : 'N/A'}`);
  lines.push(`VO2 Max: ${data.vo2max != null ? data.vo2max : 'N/A'}`);
  lines.push(`Body Battery: ${data.bodyBatteryLow != null ? data.bodyBatteryLow + '%' : '?'} -> ${data.bodyBatteryHigh != null ? data.bodyBatteryHigh + '%' : '?'}`);

  if (data.sleepEngineRecommendation) {
    const rec = data.sleepEngineRecommendation;
    lines.push(`Tonight's Recommended Bedtime (lights out): ${rec.recommendedBedtime}`);
    lines.push(`Tonight's Target Sleep Onset: ${rec.recommendedSleepOnset || 'N/A'}`);
    lines.push(`Tonight's Latest Bedtime Cutoff: ${rec.latestBedtimeCutoff || 'N/A'}`);
    lines.push(`Target Wake Time: ${rec.targetWakeTime || 'N/A'}`);
    lines.push(`Dim Lights From: ${rec.dimLightsStart || 'N/A'}`);
    lines.push(`Wind-Down Start Time: ${rec.windDownStart || 'N/A'}`);
    lines.push(`Habitual Sleep Onset (Circadian Anchor): ${rec.anchorBedtime}`);
    lines.push(`Habitual Wake Time: ${rec.habitualWakeTime || 'N/A'}`);
    lines.push(`Shift Applied: ${rec.shiftMinutes} min earlier than habitual`);
    lines.push(`Recommendation Status: ${rec.adherenceStatus}`);
    const needMins = rec.sleepNeedMins ?? (rec.sleepNeedHours != null ? rec.sleepNeedHours * 60 : null);
    const debtMins = rec.sleepDebtMins ?? (rec.sleepDebtHours != null ? rec.sleepDebtHours * 60 : null);
    if (needMins != null) lines.push(`Personal Sleep Need: ${formatDuration(needMins * 60)}`);
    if (debtMins != null) lines.push(`7-Day Net Sleep Debt: ${formatDuration(debtMins * 60)}`);
    if (rec.socialJetlag != null) lines.push(`Social Jetlag (weekend vs weekday mid-sleep): ${rec.socialJetlag} min`);
    if (rec.onsetVariabilityMins != null) lines.push(`Sleep Onset Variability: ±${rec.onsetVariabilityMins} min`);
  }

  if (data.workouts && data.workouts.length > 0) {
    const w = data.workouts[0];
    lines.push(`Recent Workout: ${w.type || 'Workout'} (${Math.round((w.duration_secs || 0) / 60)} min)`);
  }

  if (data.magnesium) {
    if (data.magnesium.taken) {
      const takenTime = data.magnesium.takenAt ? ` (logged at ${data.magnesium.takenAt})` : '';
      const dose = data.magnesium.dosage ? ` [${data.magnesium.dosage}]` : '';
      lines.push(`Magnesium Supplement: Taken${takenTime}${dose}`);
    } else {
      lines.push(`Magnesium Supplement: Not taken / Not logged for this night`);
    }
  } else {
    lines.push(`Magnesium Supplement: Not logged`);
  }

  if (data.magnesiumWeeklyStats) {
    lines.push(`Magnesium 7-Day Consistency: ${data.magnesiumWeeklyStats.takenDays}/${data.magnesiumWeeklyStats.totalDays} nights logged`);
  }

  if (data.weekSummary) {
    lines.push(`7-Day Sleep Consistency: ${data.weekSummary}`);
  }

  return lines.join('\n');
}

/**
 * Determines the sleep verdict based on objective metrics.
 * Used to tag morning reports and color-code UI.
 */
export function judgeSleep(sleepHours, bedtime) {
  if (sleepHours == null) return 'okay';

  const lateness = minutesPastBedtimeTarget(bedtime);
  const isLate = lateness != null && lateness > LATE_BEDTIME_GRACE_MINUTES;
  const isVeryLate = lateness != null && lateness > VERY_LATE_BEDTIME_MINUTES;

  if (sleepHours < 5) return 'terrible';
  if (sleepHours >= 7 && !isLate) return 'good';
  if (sleepHours >= 6 && !isVeryLate) return 'okay';
  return 'bad';
}
