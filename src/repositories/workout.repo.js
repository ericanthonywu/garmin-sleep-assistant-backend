import { db } from '../db/knex.js';

export class WorkoutRepo {
  static async upsert(workout) {
    if (workout.external_id) {
      const existing = await db('workouts').where('external_id', workout.external_id).first();
      if (existing) {
        return db('workouts')
          .where('id', existing.id)
          .update({
            ...workout,
            updated_at: db.fn.now(),
          });
      }
    }
    return db('workouts').insert(workout);
  }

  static async getByDate(date) {
    return db('workouts').where('date', date).orderBy('created_at', 'desc');
  }

  static async getRange(startDate, endDate) {
    return db('workouts')
      .whereBetween('date', [startDate, endDate])
      .orderBy('date', 'desc');
  }
}
