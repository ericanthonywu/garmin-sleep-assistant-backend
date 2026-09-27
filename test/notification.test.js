import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationService } from '../src/services/notification.service.js';

test('NotificationService suppresses real HTTP push during tests', async (t) => {
  process.env.NODE_ENV = 'test';

  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200 };
  };

  try {
    await NotificationService.sendMorningReport('Test report content', 'good');
    await NotificationService.sendPush({ title: 'Test Alert', body: 'Testing' });

    assert.equal(fetchCalled, false, 'fetch MUST NOT be called when NODE_ENV=test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
