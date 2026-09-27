import { db } from '../db/knex.js';

export class BedtimeRepo {
  static async upsertLog(data) {
    const existing = await db('bedtime_log').where('date', data.date).first();
    if (existing) {
      return db('bedtime_log')
        .where('date', data.date)
        .update({
          ...data,
          updated_at: db.fn.now(),
        });
    }
    return db('bedtime_log').insert(data);
  }

  static async getRecentLogs(limit = 14) {
    const rows = await db('bedtime_log')
      .orderBy('date', 'desc')
      .limit(limit);
    return rows.reverse();
  }

  static async getByDate(date) {
    return db('bedtime_log').where('date', date).first();
  }
}
