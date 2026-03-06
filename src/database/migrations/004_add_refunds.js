/**
 * Migration: Cria tabela de reembolsos.
 */
exports.up = async function (knex) {
    await knex.schema.createTable('refunds', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('merchant_id').notNullable().references('merchants.id');
        t.string('charge_correlation_id').notNullable(); // cobrança original
        t.string('refund_correlation_id').notNullable().unique(); // ID único deste reembolso
        t.bigInteger('value').notNullable(); // valor reembolsado em centavos
        t.string('status').defaultTo('pending'); // pending, completed, failed
        t.text('comment');
        t.text('failure_reason');
        t.timestamps(true, true);

        t.index('merchant_id');
        t.index('charge_correlation_id');
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('refunds');
};
