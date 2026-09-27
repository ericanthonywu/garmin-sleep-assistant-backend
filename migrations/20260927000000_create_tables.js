/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  return knex.schema
    // Daily wellness summaries from Intervals.icu
    .createTable('daily_wellness', (t) => {
      t.increments('id').primary();
      t.date('date').notNullable().unique();
      t.integer('sleep_score');                    // Garmin Sleep Score 0-100
      t.integer('sleep_secs');                     // Total sleep in seconds
      t.integer('resting_hr');                     // Resting heart rate (bpm)
      t.float('hrv');                              // HRV rMSSD (ms)
      t.float('vo2max');                           // VO2 Max estimate
      t.integer('body_battery_high');
      t.integer('body_battery_low');
      t.integer('steps_total');
      t.integer('active_calories');
      t.integer('intensity_minutes');
      t.jsonb('raw_json');                         // Full Intervals.icu response
      t.timestamps(true, true);
    })

    // Granular sleep stage intervals from Apple HealthKit
    .createTable('sleep_stages', (t) => {
      t.increments('id').primary();
      t.date('date').notNullable();                // Sleep night date
      t.string('stage').notNullable();             // 'deep' | 'light' | 'rem' | 'awake'
      t.timestamp('start_time').notNullable();
      t.timestamp('end_time').notNullable();
      t.integer('duration_secs').notNullable();
      t.unique(['date', 'stage', 'start_time']);   // Dedup key
    })

    // Heart rate samples from HealthKit
    .createTable('heart_rate_samples', (t) => {
      t.increments('id').primary();
      t.timestamp('timestamp').notNullable();
      t.integer('bpm').notNullable();
      t.string('context');                         // 'resting' | 'active' | 'sleep'
      t.unique(['timestamp', 'bpm']);              // Dedup key
    })

    // Workouts from Intervals.icu / HealthKit
    .createTable('workouts', (t) => {
      t.increments('id').primary();
      t.date('date').notNullable();
      t.string('type').notNullable();              // 'running' | 'cycling' | 'strength'
      t.string('name');
      t.integer('duration_secs');
      t.float('distance_meters');
      t.integer('calories');
      t.integer('avg_hr');
      t.integer('max_hr');
      t.string('source').notNullable();            // 'intervals' | 'healthkit'
      t.string('external_id');
      t.timestamps(true, true);
    })

    // Chat messages with Mom AI
    .createTable('chat_messages', (t) => {
      t.increments('id').primary();
      t.string('role').notNullable();              // 'user' | 'mom'
      t.text('content').notNullable();
      t.date('context_date');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })

    // Mom's auto-generated morning reports
    .createTable('morning_reports', (t) => {
      t.increments('id').primary();
      t.date('date').notNullable().unique();
      t.text('content').notNullable();
      t.string('sleep_verdict');                   // 'good' | 'okay' | 'bad' | 'terrible'
      t.text('recommended_bedtime');               // From sleep engine
      t.text('sleep_engine_analysis');              // JSON: full engine output
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })

    // Bedtime tracking for circadian anchor calculation
    .createTable('bedtime_log', (t) => {
      t.increments('id').primary();
      t.date('date').notNullable().unique();
      t.string('bedtime').notNullable();           // 'HH:MM' 24h format
      t.string('wake_time');                       // 'HH:MM' 24h format
      t.boolean('is_weekend').defaultTo(false);
      t.float('sleep_hours');
      t.string('target_bedtime');                  // What was recommended
      t.boolean('met_target');                     // Did they meet it?
      t.timestamps(true, true);
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  return knex.schema
    .dropTableIfExists('bedtime_log')
    .dropTableIfExists('morning_reports')
    .dropTableIfExists('chat_messages')
    .dropTableIfExists('workouts')
    .dropTableIfExists('heart_rate_samples')
    .dropTableIfExists('sleep_stages')
    .dropTableIfExists('daily_wellness');
}
