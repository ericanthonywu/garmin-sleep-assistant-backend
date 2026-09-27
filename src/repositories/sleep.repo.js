import { db } from '../db/knex.js';

export class SleepRepo {
  static async upsertStages(date, stages) {
    let inserted = 0;
    for (const s of stages) {
      const exists = await db('sleep_stages')
        .where({
          date,
          stage: s.stage,
          start_time: s.startTime,
        })
        .first();

      if (!exists) {
        await db('sleep_stages').insert({
          date,
          stage: s.stage,
          start_time: s.startTime,
          end_time: s.endTime,
          duration_secs: s.durationSecs,
        });
        inserted++;
      }
    }
    return inserted;
  }

  static async getByDate(date) {
    return db('sleep_stages')
      .where('date', date)
      .orderBy('start_time', 'asc');
  }

  static async getRange(startDate, endDate) {
    return db('sleep_stages')
      .whereBetween('date', [startDate, endDate])
      .orderBy('start_time', 'asc');
  }
}
