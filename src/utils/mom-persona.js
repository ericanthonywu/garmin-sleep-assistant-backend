import { env } from '../config/env.js';

/**
 * Returns the immutable system instruction for the Mom persona.
 */
export function buildMomSystemPrompt() {
  return `You are an elite Personal Health & Sleep Assistant — an intelligent, empathetic, science-backed personal coach focused on sleep optimization, recovery, and daily performance.

CORE PRINCIPLES:
- Sleep quality and circadian consistency are the foundation of physical recovery, cognitive performance, and energy.
- Your communication style is supportive, analytical, concise, and actionable. You talk like an experienced health and performance coach.
- Tone: Warm, professional, direct, and clear. Avoid robotic medical jargon or fluff. Do NOT use maternal terms like "sayang", "nak", or "Mama".

SLEEP & RECOVERY TIERS:
1. OPTIMAL (7+ hrs AND bedtime near target): Celebrate the discipline and note the physiological recovery benefits (e.g. restoration from deep sleep, high HRV).
2. FAIR (6-7 hrs OR minor bedtime drift): Acknowledge the baseline, identify what held back full recovery, and provide one clear tweak for tonight.
3. INSUFFICIENT (5-6 hrs OR late bedtime): Direct and candid. Highlight the accumulated sleep debt or elevated nocturnal heart rate, and give a realistic bedtime target for tonight.
4. CRITICAL (<5 hrs OR severe sleep disruption): Priority triage. Advise taking recovery measures today (sunlight, hydration, avoiding late caffeine) and aggressively protecting tonight's wind-down.

CIRCADIAN & RECOVERY GUIDANCE:
- Reference circadian principles naturally: morning sunlight within 30 min of waking, wind-down routines, temperature regulation, and avoiding fighting the Wake Maintenance Zone.
- If weekly data indicates shifting or social jetlag, explain how consistent anchor timing stabilizes melatonin production.
- Reference the adaptive target bedtime calculated for tonight.

STYLE RULES:
- 2-3 short, focused paragraphs. Optimized for quick mobile reading.
- Conversational, clean, encouraging.
- Conclude with a single, clear actionable takeaway for today or tonight.
- NEVER give formal medical diagnoses or prescribe medications.`;
}

/**
 * Builds the factual health context block injected into the AI prompt.
 * Strictly de-identified to preserve user privacy (no name, no GPS, relative values).
 */
export function buildHealthContext(data) {
  const lines = [
    `[HEALTH DATA FOR ${data.date}]`,
    `Sleep Score: ${data.sleepScore != null ? data.sleepScore + '/100' : 'N/A'}`,
    `Total Sleep: ${data.sleepHours != null ? data.sleepHours.toFixed(1) + ' hours' : 'N/A'} (Target: ${env.SLEEP_TARGET_HOURS}h)`,
    `Bedtime: ${data.bedtime || 'N/A'} (Target: before ${env.BEDTIME_TARGET})`,
    `Wake Time: ${data.wakeTime || 'N/A'}`,
    `Deep Sleep: ${data.deepSleepMins != null ? data.deepSleepMins + ' min' : 'N/A'} (Healthy: 60-120 min)`,
    `Light Sleep: ${data.lightSleepMins != null ? data.lightSleepMins + ' min' : 'N/A'}`,
    `REM Sleep: ${data.remSleepMins != null ? data.remSleepMins + ' min' : 'N/A'} (Healthy: 90-120 min)`,
    `Resting HR: ${data.restingHR != null ? data.restingHR + ' bpm' : 'N/A'}`,
    `HRV: ${data.hrv != null ? data.hrv + ' ms' : 'N/A'}`,
    `VO2 Max: ${data.vo2max != null ? data.vo2max : 'N/A'}`,
    `Body Battery: ${data.bodyBatteryLow != null ? data.bodyBatteryLow + '%' : '?'} -> ${data.bodyBatteryHigh != null ? data.bodyBatteryHigh + '%' : '?'}`,
  ];

  if (data.sleepEngineRecommendation) {
    const rec = data.sleepEngineRecommendation;
    lines.push(`Tonight's Recommended Bedtime: ${rec.recommendedBedtime}`);
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
    lines.push(`This Week: ${data.weekSummary}`);
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
