/**
 * The plan shown for each night, so the next night's step knows what the target was.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  return knex.schema.createTable('sleep_plans', (t) => {
    t.increments('id').primary();
    t.date('date').notNullable().unique();       // Evening the plan is for
    t.string('target_onset').notNullable();      // 'HH:MM' recommended sleep onset
    t.string('status').notNullable();            // advancing | holding | regressing | achieved | no_data
    t.string('hold_reason');
    t.integer('step_minutes').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  return knex.schema.dropTableIfExists('sleep_plans');
}
