const crypto = require('crypto');
const db = require('../database/connection');

/**
 * Processa um pagamento confirmado: credita merchant e taxa da plataforma.
 * Usa double-entry bookkeeping com idempotência.
 */
async function processPayment({ chargeId, merchantAccountId, amount, feeRate, idempotencyKey }) {
    return db.transaction(async (trx) => {
        // 1) Verificação de idempotência
        const existing = await trx('ledger_entries')
            .where('idempotency_key', `${idempotencyKey}_merchant_c`)
            .first();

        if (existing) {
            return { status: 'already_processed', transactionId: existing.transaction_id };
        }

        // 2) Calcula split
        const fee = Math.round(amount * feeRate);
        const merchantAmount = amount - fee;
        const txId = crypto.randomUUID();

        // 3) Busca contas do sistema
        const escrowAccount = await trx('accounts').where('owner_type', 'escrow').first();
        const platformAccount = await trx('accounts').where('owner_type', 'platform').first();

        if (!escrowAccount || !platformAccount) {
            throw new Error('System accounts not found. Run migrations first.');
        }

        // 4) Insere as 3 entradas (double-entry)
        await trx('ledger_entries').insert([
            {
                transaction_id: txId,
                account_id: escrowAccount.id,
                entry_type: 'debit',
                amount,
                description: `Pagamento recebido - Charge ${chargeId}`,
                idempotency_key: `${idempotencyKey}_escrow_d`,
            },
            {
                transaction_id: txId,
                account_id: merchantAccountId,
                entry_type: 'credit',
                amount: merchantAmount,
                description: `Crédito de venda - Charge ${chargeId}`,
                idempotency_key: `${idempotencyKey}_merchant_c`,
            },
            {
                transaction_id: txId,
                account_id: platformAccount.id,
                entry_type: 'credit',
                amount: fee,
                description: `Taxa de plataforma - Charge ${chargeId}`,
                idempotency_key: `${idempotencyKey}_platform_c`,
            },
        ]);

        // 5) Refresh da materialized view de saldos
        await trx.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY account_balances');

        return { status: 'processed', transactionId: txId, merchantAmount, fee };
    });
}

/**
 * Reserva saldo para saque (débito do merchant, crédito no escrow de saques).
 */
async function reserveForPayout({ merchantAccountId, amount, payoutId, idempotencyKey }) {
    return db.transaction(async (trx) => {
        // 1) Verifica saldo atual com lock vinculando à conta do merchant
        // Postgre não permite FOR UPDATE com agregações (SUM).
        // Então travamos a linha da CONTA primeiro.
        const account = await trx('accounts').where('id', merchantAccountId).forUpdate().first();
        if (!account) throw new Error('Merchant account not found');

        const balanceRow = await trx('ledger_entries')
            .select(trx.raw(`
                SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) -
                SUM(CASE WHEN entry_type = 'debit'  THEN amount ELSE 0 END) AS balance
            `))
            .where('account_id', merchantAccountId)
            .first();

        const balance = balanceRow?.balance || 0;

        if (balance < amount) {
            throw new Error('INSUFFICIENT_BALANCE');
        }

        // 2) Busca conta de escrow de saques
        const payoutEscrow = await trx('accounts').where('owner_type', 'payout_escrow').first();
        const txId = crypto.randomUUID();

        // 3) Débito do merchant + crédito no escrow
        await trx('ledger_entries').insert([
            {
                transaction_id: txId,
                account_id: merchantAccountId,
                entry_type: 'debit',
                amount,
                description: `Reserva para saque ${payoutId}`,
                idempotency_key: `${idempotencyKey}_merchant_d`,
            },
            {
                transaction_id: txId,
                account_id: payoutEscrow.id,
                entry_type: 'credit',
                amount,
                description: `Escrow de saque ${payoutId}`,
                idempotency_key: `${idempotencyKey}_escrow_c`,
            },
        ]);

        await trx.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY account_balances');

        return { status: 'reserved', transactionId: txId };
    });
}

/**
 * Consulta o saldo de uma conta.
 */
async function getBalance(accountId) {
    const result = await db('account_balances').where('account_id', accountId).first();
    return result?.balance || 0;
}

/**
 * Conclui um saque (dinheiro efetivamente saiu pela Woovi).
 * Debita do escrow e credita numa conta de liquidação externa (saída).
 */
async function resolvePayout({ amount, payoutId, idempotencyKey }) {
    return db.transaction(async (trx) => {
        const payoutEscrow = await trx('accounts').where('owner_type', 'payout_escrow').first();
        const externalSettlement = await trx('accounts').where('owner_type', 'external_settlement').first();

        if (!externalSettlement) {
            // Cria conta de liquidação se não existir (apenas uma vez)
            const [newAcc] = await trx('accounts').insert({
                id: crypto.randomUUID(), owner_type: 'external_settlement'
            }).returning('*');
            Object.assign(externalSettlement || {}, newAcc);
        }

        const txId = crypto.randomUUID();

        await trx('ledger_entries').insert([
            {
                transaction_id: txId,
                account_id: payoutEscrow.id,
                entry_type: 'debit',
                amount,
                description: `Saque ${payoutId} efetivado`,
                idempotency_key: `${idempotencyKey}_escrow_d`,
            },
            {
                transaction_id: txId,
                account_id: externalSettlement.id || externalSettlement, // Fallback caso acabe de ser criada
                entry_type: 'credit',
                amount,
                description: `Saída externa - Saque ${payoutId}`,
                idempotency_key: `${idempotencyKey}_ext_c`,
            },
        ]);

        await trx.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY account_balances');
        return txId;
    });
}

/**
 * Reverte um saque falho (ex: chave pix inválida).
 * Devolve o dinheiro do escrow para o merchant.
 */
async function rejectPayout({ merchantAccountId, amount, payoutId, idempotencyKey }) {
    return db.transaction(async (trx) => {
        const payoutEscrow = await trx('accounts').where('owner_type', 'payout_escrow').first();
        const txId = crypto.randomUUID();

        await trx('ledger_entries').insert([
            {
                transaction_id: txId,
                account_id: payoutEscrow.id,
                entry_type: 'debit',
                amount,
                description: `Estorno de saque falho ${payoutId}`,
                idempotency_key: `${idempotencyKey}_escrow_d`,
            },
            {
                transaction_id: txId,
                account_id: merchantAccountId,
                entry_type: 'credit',
                amount,
                description: `Devolução saque falho ${payoutId}`,
                idempotency_key: `${idempotencyKey}_merchant_c`,
            },
        ]);

        await trx.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY account_balances');
        return txId;
    });
}

module.exports = { processPayment, reserveForPayout, resolvePayout, rejectPayout, getBalance };
