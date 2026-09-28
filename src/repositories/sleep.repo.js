import { db } from '../db/knex.js';

export class SleepRepo {
  /**
   * Replaces the night's stages so relabelled or dropped segments from a re-sync don't linger.
   */
  static async replaceStages(date, stages) {
    const rows = stages.map((s) => ({
      date,
      stage: s.stage,
      start_time: s.startTime,
      end_time: s.endTime,
      duration_secs: s.durationSecs,
    }));

    await db.transaction(async (trx) => {
      await trx('sleep_stages').where('date', date).del();
      if (rows.length > 0) {
        await trx.batchInsert('sleep_stages', rows, 500);
      }
    });
    return rows.length;
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
