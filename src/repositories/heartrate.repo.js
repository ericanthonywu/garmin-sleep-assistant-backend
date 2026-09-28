import { db } from '../db/knex.js';

const BATCH_SIZE = 500;

export class HeartRateRepo {
  static async upsertSamples(samples) {
    let inserted = 0;
    for (let i = 0; i < samples.length; i += BATCH_SIZE) {
      const rows = samples.slice(i, i + BATCH_SIZE).map((s) => ({
        timestamp: s.timestamp,
        bpm: s.bpm,
        context: s.context || null,
      }));
      const result = await db('heart_rate_samples')
        .insert(rows)
        .onConflict(['timestamp', 'bpm'])
        .ignore()
        .returning('id');
      inserted += result.length;
    }
    return inserted;
  }

  static async getOvernight(startIso, endIso) {
    return db('heart_rate_samples')
      .whereBetween('timestamp', [startIso, endIso])
      .orderBy('timestamp', 'asc');
  }
}
