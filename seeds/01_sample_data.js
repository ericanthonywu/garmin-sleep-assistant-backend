/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function seed(knex) {
  // Clear existing
  await knex('bedtime_log').del();
  await knex('morning_reports').del();
  await knex('heart_rate_samples').del();
  await knex('sleep_stages').del();
  await knex('daily_wellness').del();

  const dates = [
    '2026-09-21',
    '2026-09-22',
    '2026-09-23',
    '2026-09-24',
    '2026-09-25',
    '2026-09-26',
    '2026-09-27',
  ];

  // 1. Daily Wellness (7 days)
  const wellnessData = [
    { date: '2026-09-21', sleep_score: 74, sleep_secs: 23400, resting_hr: 60, hrv: 55, vo2max: 48.0, body_battery_high: 80, body_battery_low: 20, steps_total: 7800 },
    { date: '2026-09-22', sleep_score: 79, sleep_secs: 25200, resting_hr: 58, hrv: 58, vo2max: 48.2, body_battery_high: 85, body_battery_low: 24, steps_total: 9200 },
    { date: '2026-09-23', sleep_score: 68, sleep_secs: 21600, resting_hr: 62, hrv: 50, vo2max: 48.2, body_battery_high: 70, body_battery_low: 18, steps_total: 6400 },
    { date: '2026-09-24', sleep_score: 84, sleep_secs: 27000, resting_hr: 56, hrv: 64, vo2max: 48.5, body_battery_high: 90, body_battery_low: 26, steps_total: 10500 },
    { date: '2026-09-25', sleep_score: 82, sleep_secs: 26400, resting_hr: 57, hrv: 61, vo2max: 48.5, body_battery_high: 88, body_battery_low: 25, steps_total: 8900 },
    { date: '2026-09-26', sleep_score: 80, sleep_secs: 25800, resting_hr: 56, hrv: 63, vo2max: 48.5, body_battery_high: 86, body_battery_low: 28, steps_total: 7600 },
    { date: '2026-09-27', sleep_score: 88, sleep_secs: 27600, resting_hr: 54, hrv: 70, vo2max: 48.5, body_battery_high: 95, body_battery_low: 30, steps_total: 8400 },
  ];
  await knex('daily_wellness').insert(wellnessData);

  // 2. Bedtime Log (7 days)
  const bedtimeData = [
    { date: '2026-09-21', bedtime: '00:30', wake_time: '07:00', is_weekend: false, sleep_hours: 6.5, target_bedtime: '00:00', met_target: false },
    { date: '2026-09-22', bedtime: '00:15', wake_time: '07:15', is_weekend: false, sleep_hours: 7.0, target_bedtime: '00:00', met_target: false },
    { date: '2026-09-23', bedtime: '01:00', wake_time: '07:00', is_weekend: false, sleep_hours: 6.0, target_bedtime: '00:00', met_target: false },
    { date: '2026-09-24', bedtime: '23:45', wake_time: '07:15', is_weekend: false, sleep_hours: 7.5, target_bedtime: '00:00', met_target: true },
    { date: '2026-09-25', bedtime: '00:00', wake_time: '07:20', is_weekend: false, sleep_hours: 7.3, target_bedtime: '00:00', met_target: true },
    { date: '2026-09-26', bedtime: '00:30', wake_time: '08:00', is_weekend: true, sleep_hours: 7.5, target_bedtime: '00:00', met_target: false },
    { date: '2026-09-27', bedtime: '23:30', wake_time: '07:10', is_weekend: false, sleep_hours: 7.7, target_bedtime: '00:00', met_target: true },
  ];
  await knex('bedtime_log').insert(bedtimeData);

  // 3. Sleep Stages for Last Night (2026-09-27)
  const stagesData = [
    { date: '2026-09-27', stage: 'deep', start_time: '2026-09-26T23:30:00Z', end_time: '2026-09-27T01:00:00Z', duration_secs: 5400 },
    { date: '2026-09-27', stage: 'light', start_time: '2026-09-27T01:00:00Z', end_time: '2026-09-27T02:30:00Z', duration_secs: 5400 },
    { date: '2026-09-27', stage: 'rem', start_time: '2026-09-27T02:30:00Z', end_time: '2026-09-27T03:45:00Z', duration_secs: 4500 },
    { date: '2026-09-27', stage: 'awake', start_time: '2026-09-27T03:45:00Z', end_time: '2026-09-27T03:55:00Z', duration_secs: 600 },
    { date: '2026-09-27', stage: 'light', start_time: '2026-09-27T03:55:00Z', end_time: '2026-09-27T05:15:00Z', duration_secs: 4800 },
    { date: '2026-09-27', stage: 'deep', start_time: '2026-09-27T05:15:00Z', end_time: '2026-09-27T06:00:00Z', duration_secs: 2700 },
    { date: '2026-09-27', stage: 'rem', start_time: '2026-09-27T06:00:00Z', end_time: '2026-09-27T07:10:00Z', duration_secs: 4200 },
  ];
  await knex('sleep_stages').insert(stagesData);

  // 4. Overnight Heart Rate Samples
  const hrSamples = [];
  const startEpoch = new Date('2026-09-26T23:30:00Z').getTime();
  const bpms = [66, 64, 62, 59, 57, 55, 54, 53, 52, 53, 54, 55, 56, 58, 61];
  for (let i = 0; i < bpms.length; i++) {
    const t = new Date(startEpoch + i * 30 * 60 * 1000).toISOString();
    hrSamples.push({ timestamp: t, bpm: bpms[i], context: 'sleep' });
  }
  await knex('heart_rate_samples').insert(hrSamples);

  // 5. Morning Report from Mama
  await knex('morning_reports').insert({
    date: '2026-09-27',
    content: 'Good morning! Strong physiological recovery last night: you logged 7.7 hours of sleep with a bedtime of 23:30. Your deep sleep was optimal (135 min) and resting heart rate dropped nicely to 54 bpm. Keep this consistent sleep anchor tonight to lock in your circadian rhythm.',
    sleep_verdict: 'good',
    recommended_bedtime: '23:30',
    sleep_engine_analysis: JSON.stringify({
      anchorBedtime: '23:55',
      recommendedBedtime: '23:35',
      windDownStart: '22:50',
      shiftMinutes: 20,
      socialJetlag: 20,
      adherenceStatus: 'advancing',
      guidance: 'Stepping bedtime 20 minutes earlier tonight. Gradual shifts help entrain your circadian rhythm comfortably.',
    }),
  });
}
