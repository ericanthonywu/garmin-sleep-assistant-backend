import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthService } from '../src/services/health.service.js';

test('HealthService.getSleepCalendar returns contiguous dates, aggregated metrics, and monthlyStats', async () => {
  const result = await HealthService.getSleepCalendar('2026-10-01', '2026-10-18');
  assert.ok(result);
  assert.equal(result.startDate, '2026-10-01');
  assert.equal(result.endDate, '2026-10-18');
  assert.equal(result.days.length, 18);
  assert.ok(result.monthlyStats);
  assert.ok(typeof result.monthlyStats.totalNightsTracked === 'number');
  assert.ok(result.monthlyStats.totalNightsTracked > 0);

  const day18 = result.days.find((d) => d.date === '2026-10-18');
  assert.ok(day18);
  assert.equal(day18.hasData, true);
  assert.equal(day18.sleepScore, 83);
  assert.equal(day18.sleepScoreQuality, 'good');
  assert.equal(day18.bedtime, '03:18');
  assert.equal(day18.wakeTime, '11:24');
  assert.equal(day18.magnesiumTaken, true);
});

test('HealthService.getDashboardData resets magnesium taken status if logged prior to wakeup', async () => {
  const dashData = await HealthService.getDashboardData('2026-10-18');
  assert.ok(dashData);
  assert.equal(dashData.date, '2026-10-18');
  assert.equal(dashData.bedtime, '03:18');
  assert.equal(dashData.wakeTime, '11:24');

  // Because magnesium was logged at 23:59 (after 11:24 wake time), it is taken for tonight
  assert.equal(dashData.magnesium.taken, true);
  assert.equal(dashData.magnesium.takenAt, '23:59');
});
