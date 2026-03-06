exports.up = async (knex) => {
    await knex.schema.createTable('webhook_deliveries', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('merchant_id').notNullable().references('merchants.id');
        t.string('charge_correlation_id');
        t.string('event').notNullable();
        t.string('webhook_url').notNullable();
        t.integer('status_code');
        t.integer('attempt').notNullable().defaultTo(1);
        t.string('status').notNullable();    // 'success', 'failed'
        t.text('error');
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.index('merchant_id');
        t.index('charge_correlation_id');
    });
};

exports.down = async (knex) => knex.schema.dropTableIfExists('webhook_deliveries');
