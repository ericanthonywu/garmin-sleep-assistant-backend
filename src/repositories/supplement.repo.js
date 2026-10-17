import { db } from '../db/knex.js';
import { shiftDate, formatDateKey } from '../utils/date.js';

export class SupplementRepo {
  static async upsert({
    date,
    supplement = 'magnesium',
    taken = true,
    taken_at = null,
    dosage = null,
    notes = null,
  }) {
    const existing = await db('supplement_logs')
      .where({ date, supplement })
      .first();

    const timestamp = taken && !taken_at ? new Date() : taken_at;

    if (existing) {
      await db('supplement_logs')
        .where({ date, supplement })
        .update({
          taken,
          taken_at: timestamp,
          dosage: dosage !== undefined ? dosage : existing.dosage,
          notes: notes !== undefined ? notes : existing.notes,
          updated_at: db.fn.now(),
        });
      return this.getByDate(date, supplement);
    }

    await db('supplement_logs').insert({
      date,
      supplement,
      taken,
      taken_at: timestamp,
      dosage,
      notes,
    });
    return this.getByDate(date, supplement);
  }

  static async getByDate(date, supplement = 'magnesium') {
    return db('supplement_logs')
      .where({ date, supplement })
      .first();
  }

  static async getRange(startDate, endDate, supplement = 'magnesium') {
    return db('supplement_logs')
      .where('supplement', supplement)
      .whereBetween('date', [startDate, endDate])
      .orderBy('date', 'asc');
  }

  static async deleteLog(date, supplement = 'magnesium') {
    return db('supplement_logs')
      .where({ date, supplement })
      .del();
  }

  static async getWeeklyConsistency(endDate, supplement = 'magnesium') {
    const startDate = shiftDate(endDate, -6);
    const rows = await this.getRange(startDate, endDate, supplement);
    const takenMap = new Map();
    rows.forEach((r) => {
      const dKey = formatDateKey(r.date);
      if (r.taken) {
        takenMap.set(dKey, true);
      }
    });

    let takenDays = 0;
    for (let i = 0; i < 7; i++) {
      const d = shiftDate(startDate, i);
      if (takenMap.has(d)) {
        takenDays++;
      }
    }

    return {
      takenDays,
      totalDays: 7,
      adherenceRate: Math.round((takenDays / 7) * 100),
    };
  }
}
