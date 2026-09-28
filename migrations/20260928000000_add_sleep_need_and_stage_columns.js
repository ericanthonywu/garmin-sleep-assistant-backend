const STAGE_COLUMNS = ['deep_sleep_secs', 'light_sleep_secs', 'rem_sleep_secs', 'awake_secs'];

/**
 * Stage columns already exist on some databases (added manually), so each add is guarded.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  for (const column of STAGE_COLUMNS) {
    if (!(await knex.schema.hasColumn('daily_wellness', column))) {
      await knex.schema.alterTable('daily_wellness', (t) => {
        t.integer(column);
      });
    }
  }

  if (!(await knex.schema.hasColumn('bedtime_log', 'sleep_need_mins'))) {
    await knex.schema.alterTable('bedtime_log', (t) => {
      t.integer('sleep_need_mins'); // Garmin personalised sleep need for that night
    });
  }
}

/**
 * Stage columns are left in place: they may predate this migration.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  if (await knex.schema.hasColumn('bedtime_log', 'sleep_need_mins')) {
    await knex.schema.alterTable('bedtime_log', (t) => {
      t.dropColumn('sleep_need_mins');
    });
  }
}
