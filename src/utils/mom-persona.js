import { env } from '../config/env.js';

/**
 * Returns the immutable system instruction for the Personal Health Assistant persona.
 */
export function buildMomSystemPrompt() {
  return `You are an elite Personal Health & Sleep Assistant — an intelligent, empathetic, science-backed personal coach focused on sleep timing optimization, sleep architecture quality, and daily physiological recovery.

CORE OBJECTIVES:
1. ANALYZE SLEEP TIMING:
   - Evaluate Bedtime and Wake Time against circadian rhythm principles.
   - Assess circadian anchor consistency, social jetlag, and tonight's recommended bedtime window.
   - Emphasize the "Latest Time to Sleep Cutoff" — the circadian ceiling past which core body temperature rises and deep sleep is sacrificed.

2. ANALYZE QUALITY OF SLEEP:
   - Deep Sleep (NREM 3/4): Crucial for physical restoration, immune function, and growth hormone release (Target: 15-25% / 60-120 min).
   - REM Sleep: Crucial for cognitive restoration, emotional processing, and neuroplasticity (Target: 20-25% / 90-120 min).
   - Sleep Continuity & Awake Interruptions: Sleep efficiency and fragmentation.
   - Cardiovascular Recovery: Overnight resting heart rate drop (nocturnal nadir) and HRV indicating parasympathetic dominance.

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
  const lines = [
    `[HEALTH & SLEEP DATA FOR ${data.date}]`,
    `Sleep Score: ${data.sleepScore != null ? data.sleepScore + '/100' : 'N/A'}`,
    `Total Sleep: ${data.sleepHours != null ? data.sleepHours.toFixed(1) + ' hours' : 'N/A'} (Target: ${env.SLEEP_TARGET_HOURS}h)`,
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
    lines.push(`Tonight's Recommended Bedtime: ${rec.recommendedBedtime}`);
    lines.push(`Tonight's Latest Bedtime Cutoff (Circadian Ceiling): ${rec.latestBedtimeCutoff || 'N/A'}`);
    lines.push(`Target Wake Time: ${rec.targetWakeTime || 'N/A'}`);
    lines.push(`Wind-Down Start Time: ${rec.windDownStart || 'N/A'}`);
    lines.push(`Circadian Anchor: ${rec.anchorBedtime}`);
    lines.push(`Shift Applied: ${rec.shiftMinutes} min earlier`);
    lines.push(`Recommendation Status: ${rec.adherenceStatus}`);
  }

  if (data.workouts && data.workouts.length > 0) {
    const w = data.workouts[0];
    lines.push(`Recent Workout: ${w.type || 'Workout'} (${Math.round((w.duration_secs || 0) / 60)} min)`);
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
export function judgeSleep(sleepHours, bedtimeHour) {
  if (sleepHours == null) return 'okay';

  const targetHour = parseInt(env.BEDTIME_TARGET.split(':')[0], 10); // e.g. 0

  const isLate = bedtimeHour != null && (
    targetHour === 0
      ? (bedtimeHour >= 1 && bedtimeHour < 12)
      : (bedtimeHour > targetHour || (bedtimeHour >= 0 && bedtimeHour < 6))
  );

  const isVeryLate = bedtimeHour != null && (bedtimeHour >= 2 && bedtimeHour < 7);

  if (sleepHours < 5) return 'terrible';
  if (sleepHours >= 7 && !isLate) return 'good';
  if (sleepHours >= 6 && !isVeryLate) return 'okay';
  return 'bad';
}
