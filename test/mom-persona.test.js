import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.BEDTIME_TARGET = '02:00';
process.env.SLEEP_TARGET_HOURS = '8';
process.env.TIMEZONE = 'Asia/Jakarta';

const { judgeSleep, buildHealthContext, buildMomSystemPrompt } = await import('../src/utils/mom-persona.js');
const { analyzeWeekPattern } = await import('../src/utils/sleep-analyzer.js');

test('judgeSleep grades lateness relative to BEDTIME_TARGET', () => {
  assert.equal(judgeSleep(7.5, '01:30'), 'good');
  assert.equal(judgeSleep(7.5, '2026-09-27T18:30:00Z'), 'good'); // 01:30 in Jakarta
  assert.equal(judgeSleep(7.5, null), 'good');
  assert.equal(judgeSleep(7.5, '02:45'), 'okay');
  assert.equal(judgeSleep(6.5, '04:00'), 'bad');
  assert.equal(judgeSleep(4.0, '01:00'), 'terrible');
});

test('analyzeWeekPattern counts late bedtimes from HH:MM strings', () => {
  const result = analyzeWeekPattern([
    { date: '2026-09-21', sleepHours: 7.5, bedtime: '01:30' },
    { date: '2026-09-22', sleepHours: 7.5, bedtime: '02:20' },
    { date: '2026-09-23', sleepHours: 7.5, bedtime: '03:10' },
    { date: '2026-09-24', sleepHours: 7.5, bedtime: '23:30' },
  ]);
  assert.equal(result.lateBedtimeCount, 1);
});

test('buildHealthContext anonymizes data without personal identifiers', () => {
  const context = buildHealthContext({
    date: '2026-09-27',
    sleepScore: 82,
    sleepHours: 7.2,
    bedtime: '23:45',
    restingHR: 56,
    hrv: 62,
  });

  assert.ok(context.includes('Sleep Score: 82/100'));
  assert.ok(context.includes('Total Sleep: 7h 12m'));
  assert.ok(!context.includes('Eric'));
  assert.ok(!context.includes('GPS'));
});

test('buildHealthContext prefers exact seconds over rounded hours', () => {
  const context = buildHealthContext({ date: '2026-09-27', sleepHours: 6.8, sleepSecs: 6 * 3600 + 50 * 60 });
  assert.ok(context.includes('Total Sleep: 6h 50m'));
});

test('formatDuration never renders 60 minutes', async () => {
  const { formatDuration } = await import('../src/utils/date.js');
  assert.equal(formatDuration(6 * 3600 + 3590), '7h');
  assert.equal(formatDuration(6 * 3600 + 50 * 60), '6h 50m');
  assert.equal(formatDuration(45 * 60), '45m');
});

test('buildMomSystemPrompt includes health assistant rules', () => {
  const prompt = buildMomSystemPrompt();
  assert.ok(prompt.includes('Personal Health & Sleep Assistant'));
  assert.ok(prompt.includes('circadian'));
  assert.ok(prompt.includes('recovery'));
});
