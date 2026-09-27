import { db } from '../db/knex.js';

export class HeartRateRepo {
  static async upsertSamples(samples) {
    let inserted = 0;
    for (const s of samples) {
      const exists = await db('heart_rate_samples')
        .where({
          timestamp: s.timestamp,
          bpm: s.bpm,
        })
        .first();

      if (!exists) {
        await db('heart_rate_samples').insert({
          timestamp: s.timestamp,
          bpm: s.bpm,
          context: s.context || null,
        });
        inserted++;
      }
    }
    return inserted;
  }

  static async getOvernight(startIso, endIso) {
    return db('heart_rate_samples')
      .whereBetween('timestamp', [startIso, endIso])
      .orderBy('timestamp', 'asc');
  }
}
