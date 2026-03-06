/**
 * Migration: Cria toda a estrutura inicial do banco de dados.
 */
exports.up = async function (knex) {
    // 1) Merchants (donos de bots)
    await knex.schema.createTable('merchants', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.string('name').notNullable();
        t.string('email').notNullable().unique();
        t.string('api_key_hash').notNullable();
        t.string('api_key_prefix', 20).notNullable(); // "bst_live_abc..." para lookup rápido
        t.uuid('account_id'); // FK para accounts (criada depois)
        t.string('webhook_url'); // URL do Bot para receber notificações
        t.string('pix_key'); // Chave Pix para payouts
        t.string('pix_key_type'); // cpf, cnpj, email, phone, random
        t.boolean('is_active').defaultTo(true);
        t.timestamps(true, true);
    });

    // 2) Accounts (contas contábeis - merchants, plataforma, escrow, etc.)
    await knex.schema.createTable('accounts', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.string('owner_type').notNullable(); // 'merchant', 'platform', 'escrow', 'payout_escrow', 'tax'
        t.uuid('owner_id'); // FK para merchants (ou null para contas do sistema)
        t.string('currency').defaultTo('BRL');
        t.timestamps(true, true);
    });

    // Adiciona FK de merchant -> account
    await knex.schema.alterTable('merchants', (t) => {
        t.foreign('account_id').references('accounts.id');
    });

    // 3) Ledger Entries (IMUTÁVEL - nunca UPDATE, nunca DELETE)
    await knex.schema.createTable('ledger_entries', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('transaction_id').notNullable().index();
        t.uuid('account_id').notNullable().references('accounts.id');
        t.string('entry_type').notNullable(); // 'debit' ou 'credit'
        t.bigInteger('amount').notNullable(); // centavos, sempre positivo
        t.text('description');
        t.string('idempotency_key').unique();
        t.timestamp('created_at').defaultTo(knex.fn.now());

        t.index(['account_id', 'created_at']);
    });

    // 4) Charges (cobranças Pix)
    await knex.schema.createTable('charges', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.string('correlation_id').notNullable().unique();
        t.uuid('merchant_id').notNullable().references('merchants.id');
        t.bigInteger('value').notNullable();
        t.string('status').defaultTo('pending'); // pending, paid, expired, refunded
        t.text('br_code');
        t.text('qr_code_image');
        t.text('payment_link_url');
        t.string('woovi_global_id');
        t.timestamp('expires_at');
        t.timestamp('paid_at');
        t.jsonb('metadata');
        t.timestamps(true, true);

        t.index('status');
        t.index('merchant_id');
    });

    // 5) Webhook Events (audit trail)
    await knex.schema.createTable('webhook_events', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.string('source').notNullable().defaultTo('woovi');
        t.string('event_type').notNullable();
        t.string('correlation_id').notNullable();
        t.jsonb('payload').notNullable();
        t.text('signature');
        t.string('status').defaultTo('received'); // received, processing, processed, failed
        t.timestamp('processed_at');
        t.text('error');
        t.timestamp('created_at').defaultTo(knex.fn.now());

        t.unique(['source', 'correlation_id', 'event_type']);
    });

    // 6) Payouts (saques)
    await knex.schema.createTable('payouts', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('merchant_id').notNullable().references('merchants.id');
        t.bigInteger('amount').notNullable();
        t.bigInteger('fee').defaultTo(0);
        t.string('status').defaultTo('requested'); // requested, approved, processing, completed, failed, rejected
        t.string('pix_key').notNullable();
        t.string('pix_key_type').notNullable();
        t.string('external_id'); // correlationID na Woovi
        t.uuid('reviewed_by');
        t.timestamp('reviewed_at');
        t.timestamp('completed_at');
        t.text('failure_reason');
        t.string('idempotency_key').unique();
        t.timestamps(true, true);

        t.index('merchant_id');
        t.index('status');
    });

    // 7) Materialized View para saldos (leitura rápida)
    await knex.raw(`
    CREATE MATERIALIZED VIEW account_balances AS
    SELECT
      account_id,
      SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) -
      SUM(CASE WHEN entry_type = 'debit'  THEN amount ELSE 0 END) AS balance
    FROM ledger_entries
    GROUP BY account_id
  `);

    await knex.raw(`
    CREATE UNIQUE INDEX idx_account_balances_account ON account_balances(account_id)
  `);

    // 8) Seed: contas do sistema
    const [escrowAccount] = await knex('accounts').insert({ owner_type: 'escrow' }).returning('id');
    const [platformAccount] = await knex('accounts').insert({ owner_type: 'platform' }).returning('id');
    const [payoutEscrow] = await knex('accounts').insert({ owner_type: 'payout_escrow' }).returning('id');

    console.log('✅ Contas do sistema criadas:');
    console.log(`   Escrow:        ${escrowAccount.id}`);
    console.log(`   Platform:      ${platformAccount.id}`);
    console.log(`   Payout Escrow: ${payoutEscrow.id}`);
};

exports.down = async function (knex) {
    await knex.raw('DROP MATERIALIZED VIEW IF EXISTS account_balances');
    await knex.schema.dropTableIfExists('payouts');
    await knex.schema.dropTableIfExists('webhook_events');
    await knex.schema.dropTableIfExists('charges');
    await knex.schema.dropTableIfExists('ledger_entries');
    await knex.schema.alterTable('merchants', (t) => {
        t.dropForeign('account_id');
    });
    await knex.schema.dropTableIfExists('accounts');
    await knex.schema.dropTableIfExists('merchants');
};
