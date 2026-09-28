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

  static async getRange(startDate, endDate) {
    return db('bedtime_log')
      .select('date', 'bedtime', 'wake_time', 'is_weekend', 'sleep_hours', 'sleep_need_mins')
      .whereBetween('date', [startDate, endDate])
      .orderBy('date', 'asc');
  }

  static async getByDate(date) {
    return db('bedtime_log').where('date', date).first();
  }
}
