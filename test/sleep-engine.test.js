import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.BEDTIME_TARGET = '02:00';
process.env.SLEEP_TARGET_HOURS = '8';
process.env.SLEEP_LATENCY_MINUTES = '15';
process.env.TIMEZONE = 'Asia/Jakarta';

const { SleepEngineService } = await import('../src/services/sleep-engine.service.js');
const { resolveDueNudge } = await import('../src/jobs/bedtime-reminder.job.js');

function nights(count, night, startDay = 14) {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-09-${String(startDay + i).padStart(2, '0')}`,
    isWeekend: false,
    ...night,
  }));
}

test('time conversion handles midnight correctly', () => {
  assert.equal(SleepEngineService.timeToMinutesPastNoon('12:00'), 0);
  assert.equal(SleepEngineService.timeToMinutesPastNoon('23:00'), 660);
  assert.equal(SleepEngineService.timeToMinutesPastNoon('00:00'), 720);
  assert.equal(SleepEngineService.timeToMinutesPastNoon('02:00'), 840);

  assert.equal(SleepEngineService.minutesPastNoonToTime(720), '00:00');
  assert.equal(SleepEngineService.minutesPastNoonToTime(840), '02:00');
  assert.equal(SleepEngineService.minutesPastNoonToTime(-10), '11:50');
  assert.equal(SleepEngineService.minutesPastNoonToTime(1450), '12:10');
});

test('anchor uses a recency-weighted circular mean across midnight', () => {
  const anchor = SleepEngineService.calculateAnchorBedtime([
    SleepEngineService.timeToMinutesPastNoon('23:45'),
    SleepEngineService.timeToMinutesPastNoon('00:45'),
  ]);
  assert.equal(SleepEngineService.minutesPastNoonToTime(anchor), '23:50');
});

test('advances 20 min when recent nights are on track, with wind-down derived from bedtime', () => {
  const history = nights(7, { bedtime: '03:00', wakeTime: '11:00', sleepHours: 7.7, sleepNeedMins: 460 });
  const rec = SleepEngineService.recommend(history, { date: '2026-09-20' });

  assert.equal(rec.adherenceStatus, 'advancing');
  assert.equal(rec.anchorBedtime, '03:00');
  assert.equal(rec.habitualWakeTime, '11:00');
  assert.equal(rec.shiftMinutes, 20);
  assert.equal(rec.recommendedSleepOnset, '02:40');
  assert.equal(rec.recommendedBedtime, '02:25');
  assert.equal(rec.latestBedtimeCutoff, '03:10');
  assert.equal(rec.windDownStart, '01:25');
  assert.equal(rec.dimLightsStart, '00:25');
  // onset + 460 min need + 18 min typical awake time
  assert.equal(rec.targetWakeTime, '10:38');
  assert.equal(rec.sleepNeedHours, 7.7);
  assert.equal(rec.sleepDebtHours, 0);
});

test('a single outlier night does not drag the anchor or block advancing', () => {
  const history = [
    ...nights(6, { bedtime: '02:30', wakeTime: '10:00', sleepHours: 7.5, sleepNeedMins: 460 }),
    { date: '2026-09-20', isWeekend: false, bedtime: '06:42', wakeTime: '14:30', sleepHours: 7.5, sleepNeedMins: 460 },
  ];
  const rec = SleepEngineService.recommend(history, { date: '2026-09-20' });

  assert.equal(rec.anchorBedtime, '02:30');
  assert.equal(rec.outlierNights, 1);
  assert.equal(rec.adherenceStatus, 'advancing');
  assert.equal(rec.recommendedSleepOnset, '02:10');
});

test('drifting later holds at the anchor and never recommends a later time', () => {
  const history = [
    ...nights(5, { bedtime: '02:30', wakeTime: '10:00', sleepHours: 7.5 }),
    ...nights(2, { bedtime: '03:45', wakeTime: '11:15', sleepHours: 7.5 }, 19),
  ];
  const rec = SleepEngineService.recommend(history, { date: '2026-09-20' });

  assert.equal(rec.adherenceStatus, 'regressing');
  assert.equal(rec.shiftMinutes, 0);
  assert.equal(rec.recommendedSleepOnset, rec.anchorBedtime);
});

test('a short last night holds instead of advancing', () => {
  const history = [
    ...nights(6, { bedtime: '03:00', wakeTime: '11:00', sleepHours: 7.7, sleepNeedMins: 460 }),
    { date: '2026-09-20', isWeekend: false, bedtime: '03:00', wakeTime: '08:20', sleepHours: 5.0, sleepNeedMins: 460 },
  ];
  const rec = SleepEngineService.recommend(history, { date: '2026-09-20' });

  assert.equal(rec.adherenceStatus, 'holding');
  assert.equal(rec.shiftMinutes, 0);
});

test('reports achieved and keeps an earlier-than-goal habit', () => {
  const history = nights(7, { bedtime: '01:50', wakeTime: '09:40', sleepHours: 7.7 });
  const rec = SleepEngineService.recommend(history, { date: '2026-09-20' });

  assert.equal(rec.adherenceStatus, 'achieved');
  assert.equal(rec.recommendedSleepOnset, '01:50');
  assert.equal(rec.shiftMinutes, 0);
});

test('social jetlag compares weekend vs weekday mid-sleep', () => {
  const jetlag = SleepEngineService.calculateSocialJetlag([
    ...nights(5, { bedtime: '02:00', wakeTime: '10:00' }),
    ...nights(2, { bedtime: '03:00', wakeTime: '13:00', isWeekend: true }, 19),
  ]);
  assert.equal(jetlag, 120);
});

test('falls back to goal-based plan without history', () => {
  const rec = SleepEngineService.recommend([]);

  assert.equal(rec.adherenceStatus, 'no_data');
  assert.equal(rec.recommendedSleepOnset, '02:00');
  assert.equal(rec.recommendedBedtime, '01:45');
  assert.equal(rec.latestBedtimeCutoff, '02:30');
  assert.equal(rec.targetWakeTime, '10:00');
  assert.equal(rec.windDownStart, '00:45');
  assert.equal(rec.dimLightsStart, '23:45');
});

test('bedtime nudges follow tonight\'s plan in order', () => {
  const rec = SleepEngineService.recommend([]);
  const at = (hhmm) => resolveDueNudge(rec, SleepEngineService.timeToMinutesPastNoon(hhmm));

  assert.equal(at('22:00'), null);
  assert.equal(at('23:50').kind, 'dim');
  assert.equal(at('00:50').kind, 'winddown');
  assert.equal(at('01:45').kind, 'bedtime');
  assert.equal(at('02:35').kind, 'cutoff');
  assert.deepEqual(at('02:45'), { kind: 'late', key: 'late-0' });
  assert.deepEqual(at('03:00'), { kind: 'late', key: 'late-1' });
  assert.equal(at('04:15'), null);
});
