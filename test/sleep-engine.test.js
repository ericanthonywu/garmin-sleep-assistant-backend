import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SleepEngineService } from '../src/services/sleep-engine.service.js';

test('SleepEngineService time conversion handles midnight correctly', () => {
  // 12:00 PM = 0
  assert.equal(SleepEngineService.timeToMinutesPastNoon('12:00'), 0);
  // 11:00 PM = 660
  assert.equal(SleepEngineService.timeToMinutesPastNoon('23:00'), 660);
  // 00:00 (Midnight) = 720
  assert.equal(SleepEngineService.timeToMinutesPastNoon('00:00'), 720);
  // 02:00 AM = 840
  assert.equal(SleepEngineService.timeToMinutesPastNoon('02:00'), 840);

  // Reverse conversion
  assert.equal(SleepEngineService.minutesPastNoonToTime(720), '00:00');
  assert.equal(SleepEngineService.minutesPastNoonToTime(840), '02:00');
});

test('SleepEngineService circular mean avoids midnight arithmetic wrap bug', () => {
  // 23:45 (645 min past noon) and 00:45 (765 min past noon)
  // Linear arithmetic might fail or produce weird numbers if wrapped around 0,
  // but circular mean centered around midnight correctly averages to 00:15 (735 min past noon).
  const m1 = SleepEngineService.timeToMinutesPastNoon('23:45');
  const m2 = SleepEngineService.timeToMinutesPastNoon('00:45');

  const anchor = SleepEngineService.calculateAnchorBedtime([m1, m2]);
  const anchorTime = SleepEngineService.minutesPastNoonToTime(anchor);

  // With exponential recency weights, the latter value receives higher weight, producing 00:22.
  assert.equal(anchorTime, '00:22');
});

test('SleepEngineService gradual 20-min shift for late sleeper', () => {
  const history = [
    { date: '2026-09-20', bedtime: '02:00', isWeekend: false, sleepHours: 6.5 },
    { date: '2026-09-21', bedtime: '02:00', isWeekend: false, sleepHours: 6.0 },
    { date: '2026-09-22', bedtime: '02:00', isWeekend: false, sleepHours: 6.8 },
  ];

  const rec = SleepEngineService.recommend(history);
  assert.equal(rec.anchorBedtime, '02:00');
  // Advancing by 20 minutes earlier (01:40)
  assert.equal(rec.recommendedBedtime, '01:40');
  assert.equal(rec.shiftMinutes, 20);
  assert.equal(rec.adherenceStatus, 'advancing');
});
