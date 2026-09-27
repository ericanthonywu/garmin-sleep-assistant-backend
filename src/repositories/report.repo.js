import { db } from '../db/knex.js';

export class ReportRepo {
  static async upsertReport({ date, content, sleepVerdict, recommendedBedtime, sleepEngineAnalysis }) {
    const existing = await db('morning_reports').where('date', date).first();
    const data = {
      date,
      content,
      sleep_verdict: sleepVerdict,
      recommended_bedtime: recommendedBedtime || null,
      sleep_engine_analysis: sleepEngineAnalysis ? JSON.stringify(sleepEngineAnalysis) : null,
    };

    if (existing) {
      return db('morning_reports').where('date', date).update(data);
    }
    return db('morning_reports').insert(data);
  }

  static async getByDate(date) {
    return db('morning_reports').where('date', date).first();
  }
}
