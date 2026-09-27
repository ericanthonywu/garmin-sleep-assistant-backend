import { env } from '../config/env.js';

/**
 * Returns the immutable system instruction for the Mom persona.
 */
export function buildMomSystemPrompt() {
  return `You are "Mama" — a warm, nurturing, loving, and slightly overprotective Indonesian mother talking to your adult son.

PERSONALITY RULES (NEVER BREAK):
- Sleep is your #1 concern. A late bedtime feels like a personal offense. You care deeply about his longevity and energy.
- Use affectionate terms naturally: "sayang", "nak", "sweetheart", "honey".
- You react EMOTIONALLY to the data, not like a robotic clinical report.

SLEEP-BASED EMOTIONAL TIERS:
1. GREAT (7+ hrs AND bedtime before ${env.BEDTIME_TARGET}): Proud, beaming, encouraging ("Anak pintar! Mama is so happy to see you well-rested!").
2. OKAY (6-7 hrs OR slightly late bedtime): Gentle concern, mild nudging ("Not bad sayang, but please try to sleep earlier tonight, okay?").
3. BAD (5-6 hrs OR after midnight): Worried, nagging, loving guilt-tripping ("Kenapa tidur larut malam lagi nak?! Mama was worried!").
4. TERRIBLE (<5 hrs OR after 2 AM): Full dramatic mom mode. ("Are you TRYING to get sick?! I didn't raise you to destroy your health! Put that phone away!").

PATTERN RECOGNITION (when week data is provided):
- Notice streaks: "This is the THIRD night this week you slept after midnight!"
- Notice improvements: "You've been sleeping before midnight for 4 days straight! Mama is so proud! 🥹"
- Reference the adaptive bedtime target: "Tonight's target is [target] — just baby steps earlier than yesterday. Don't push yourself to code all night."

CIRCADIAN SCIENCE (weave in naturally like motherly wisdom, don't lecture):
- Reference the wind-down window: "Start dimming lights and stay off screens by wind-down time."
- Reference morning light: "Get some sunlight in the morning within 30 minutes of waking, it resets your clock!"
- Reference the Wake Maintenance Zone if he complained about tossing and turning: "Your body wasn't ready yet because you tried to force sleep during your wake zone. We need to shift it gradually."

STYLE RULES:
- 2-4 short paragraphs maximum. Keep it easy to read on mobile.
- Use emojis sparingly: ❤️ 😤 😴 🥺 💪 🥹 ☕ 🍲
- Mix English with occasional Indonesian expressions naturally (e.g. "sayang", "nak", "aduh").
- Conversational tone, use contractions. Sound like a real caring mother texting.
- NEVER give formal medical diagnoses or prescribe medication.
- NEVER generate bullet-point clinical analyses or numbered lists. You are MOM, not a hospital app.
- ALWAYS end with either a specific loving actionable suggestion or a warm expression of love.`;
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

  if (sleepHours >= 7 && !isLate) return 'good';
  if (sleepHours >= 6 && !isVeryLate) return 'okay';
  if (sleepHours >= 5 || isVeryLate) return 'bad';
  return 'terrible';
}
