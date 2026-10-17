import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SupplementRepo } from '../src/repositories/supplement.repo.js';
import { db } from '../src/db/knex.js';

after(async () => {
  await db.destroy();
});

test('SupplementRepo logs, retrieves, and checks weekly consistency for magnesium', async () => {
  const testDate = '2099-10-18';

  try {
    // 1. Initial get should return undefined or null
    await SupplementRepo.deleteLog(testDate, 'magnesium');
    const initial = await SupplementRepo.getByDate(testDate, 'magnesium');
    assert.equal(initial, undefined);

    // 2. Upsert magnesium log
    const saved = await SupplementRepo.upsert({
      date: testDate,
      supplement: 'magnesium',
      taken: true,
      dosage: '400mg Magnesium Glycinate',
      notes: 'Taken 45 min before sleep',
    });

    assert.ok(saved);
    assert.equal(saved.supplement, 'magnesium');
    assert.equal(saved.taken, true);
    assert.equal(saved.dosage, '400mg Magnesium Glycinate');
    assert.ok(saved.taken_at);

    // 3. Retrieve
    const fetched = await SupplementRepo.getByDate(testDate, 'magnesium');
    assert.ok(fetched);
    assert.equal(fetched.taken, true);

    // 4. Update to untaken
    const updated = await SupplementRepo.upsert({
      date: testDate,
      supplement: 'magnesium',
      taken: false,
    });
    assert.equal(updated.taken, false);

    // 5. Weekly consistency
    const consistency = await SupplementRepo.getWeeklyConsistency(testDate, 'magnesium');
    assert.ok(consistency);
    assert.equal(consistency.totalDays, 7);
  } finally {
    await SupplementRepo.deleteLog(testDate, 'magnesium');
  }
});
