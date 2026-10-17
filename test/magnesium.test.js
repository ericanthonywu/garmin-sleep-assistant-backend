import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SleepEngineService } from '../src/services/sleep-engine.service.js';
import { resolveDueNudge } from '../src/jobs/bedtime-reminder.job.js';
import { NotificationService } from '../src/services/notification.service.js';
import { buildMomSystemPrompt, buildHealthContext } from '../src/utils/mom-persona.js';

test('SleepEngine calculates magnesium reminder 45 min before recommended bedtime', () => {
  const rec = SleepEngineService.recommend([]);
  // Default goal bedtime: 01:45
  assert.equal(rec.recommendedBedtime, '01:45');
  // 45 min prior to 01:45 is 01:00
  assert.equal(rec.magnesiumReminderTime, '01:00');
});

test('resolveDueNudge detects magnesium nudge in its 15-minute window', () => {
  const rec = SleepEngineService.recommend([]);
  const at = (hhmm) => resolveDueNudge(rec, SleepEngineService.timeToMinutesPastNoon(hhmm));

  // Bedtime: 01:45. Winddown: 00:45. Magnesium: 01:00.
  assert.equal(at('00:50').kind, 'winddown');
  assert.equal(at('01:05').kind, 'magnesium');
  assert.equal(at('01:45').kind, 'bedtime');
});

test('NotificationService sends magnesium reminder with proper messaging', async () => {
  process.env.NODE_ENV = 'test';
  let pushedPayload = null;

  const originalSendPush = NotificationService.sendPush;
  NotificationService.sendPush = async (payload) => {
    pushedPayload = payload;
  };

  try {
    const rec = {
      recommendedBedtime: '01:45',
      latestBedtimeCutoff: '02:30',
      targetWakeTime: '10:00',
    };

    await NotificationService.sendBedtimeReminder({
      kind: 'magnesium',
      rec,
      currentTimeStr: '01:00',
    });

    assert.ok(pushedPayload, 'Push should have been constructed');
    assert.match(pushedPayload.title, /Magnesium/i);
    assert.match(pushedPayload.body, /magnesium/i);
    assert.deepEqual(pushedPayload.tags, ['pill', 'crescent_moon']);
  } finally {
    NotificationService.sendPush = originalSendPush;
  }
});

test('buildMomSystemPrompt includes magnesium supplement consideration objective', () => {
  const prompt = buildMomSystemPrompt();
  assert.match(prompt, /MAGNESIUM/i);
  assert.match(prompt, /GABA/i);
  assert.match(prompt, /deep sleep/i);
});

test('buildHealthContext renders magnesium intake when taken and when not taken', () => {
  const contextTaken = buildHealthContext({
    date: '2026-10-18',
    sleepHours: 7.5,
    magnesium: {
      taken: true,
      takenAt: '22:30',
      dosage: '400mg Glycinate',
    },
    magnesiumWeeklyStats: {
      takenDays: 6,
      totalDays: 7,
      adherenceRate: 86,
    },
  });

  assert.match(contextTaken, /Magnesium Supplement: Taken \(logged at 22:30\) \[400mg Glycinate\]/);
  assert.match(contextTaken, /Magnesium 7-Day Consistency: 6\/7 nights logged/);

  const contextNotTaken = buildHealthContext({
    date: '2026-10-18',
    sleepHours: 6.0,
    magnesium: {
      taken: false,
    },
  });

  assert.match(contextNotTaken, /Magnesium Supplement: Not taken \/ Not logged for this night/);
});
