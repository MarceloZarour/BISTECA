/**
 * Migration: Adiciona 'fee_rate' na tabela de merchants.
 */
exports.up = async function (knex) {
    await knex.schema.alterTable('merchants', (t) => {
        // Decimal com 4 casas (ex: 0.0450 para 4.5%)
        // Default de 5% (0.05) para lojistas antigos
        t.decimal('fee_rate', 5, 4).notNullable().defaultTo(0.0500);
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable('merchants', (t) => {
        t.dropColumn('fee_rate');
    });
};
