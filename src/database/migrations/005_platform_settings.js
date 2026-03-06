exports.up = async (knex) => {
    await knex.schema.createTable('platform_settings', (t) => {
        t.string('key').primary();
        t.text('value').nullable();
        t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
};

exports.down = async (knex) => knex.schema.dropTableIfExists('platform_settings');
