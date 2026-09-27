import { db } from '../db/knex.js';

export class WellnessRepo {
  static async upsert(data) {
    const existing = await db('daily_wellness').where('date', data.date).first();
    if (existing) {
      return db('daily_wellness')
        .where('date', data.date)
        .update({
          ...data,
          updated_at: db.fn.now(),
        });
    }
    return db('daily_wellness').insert(data);
  }

  static async getByDate(date) {
    return db('daily_wellness').where('date', date).first();
  }

  static async getRange(startDate, endDate) {
    return db('daily_wellness')
      .whereBetween('date', [startDate, endDate])
      .orderBy('date', 'asc');
  }
}
