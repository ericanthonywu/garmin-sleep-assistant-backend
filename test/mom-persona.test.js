import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeSleep, buildHealthContext, buildMomSystemPrompt } from '../src/utils/mom-persona.js';

test('judgeSleep correctly assigns emotional verdicts', () => {
  assert.equal(judgeSleep(7.5, 23), 'good');
  assert.equal(judgeSleep(6.5, 0), 'okay');
  assert.equal(judgeSleep(5.5, 1), 'bad');
  assert.equal(judgeSleep(4.0, 3), 'terrible');
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
  assert.ok(context.includes('Total Sleep: 7.2 hours'));
  assert.ok(!context.includes('Eric'));
  assert.ok(!context.includes('GPS'));
});

test('buildMomSystemPrompt includes caring rules', () => {
  const prompt = buildMomSystemPrompt();
  assert.ok(prompt.includes('Mama'));
  assert.ok(prompt.includes('sayang'));
  assert.ok(prompt.includes('nak'));
});
