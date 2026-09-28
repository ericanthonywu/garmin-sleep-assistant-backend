import { db } from '../db/knex.js';

export class SleepPlanRepo {
  static async getByDate(date) {
    return db('sleep_plans').where('date', date).first();
  }

  static async upsert({ date, targetOnset, status, holdReason, stepMinutes }) {
    return db('sleep_plans')
      .insert({
        date,
        target_onset: targetOnset,
        status,
        hold_reason: holdReason || null,
        step_minutes: stepMinutes || 0,
      })
      .onConflict('date')
      .merge(['target_onset', 'status', 'hold_reason', 'step_minutes', 'updated_at']);
  }
}
