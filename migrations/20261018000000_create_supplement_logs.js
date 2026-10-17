/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  return knex.schema.createTable('supplement_logs', (t) => {
    t.increments('id').primary();
    t.date('date').notNullable();                          // Sleep night date (YYYY-MM-DD)
    t.string('supplement').notNullable().defaultTo('magnesium'); // Supplement name / type
    t.boolean('taken').notNullable().defaultTo(true);       // Whether taken
    t.timestamp('taken_at');                               // Timestamp when taken
    t.string('dosage');                                    // e.g. '400mg Glycinate'
    t.text('notes');                                       // Optional notes
    t.unique(['date', 'supplement']);                      // One log per supplement per date
    t.timestamps(true, true);
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  return knex.schema.dropTableIfExists('supplement_logs');
}
