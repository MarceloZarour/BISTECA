/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.createTable('payouts', table => {
        table.string('id').primary();
        table.string('merchant_id').references('id').inTable('merchants').onDelete('CASCADE').notNullable();
        table.integer('amount').notNullable();
        table.string('pix_key').notNullable();
        table.string('pix_key_type');
        table.string('correlation_id').notNullable().unique();
        table.string('status').notNullable().defaultTo('pending');
        table.json('woovi_response');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('completed_at');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.dropTable('payouts');
};
