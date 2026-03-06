const { Worker } = require('bullmq');
const Redis = require('ioredis');
const db = require('../database/connection');
const ledger = require('../services/ledger');
const config = require('../config');

// Configuração única do Redis para o Worker
const connection = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null,
});

/**
 * Worker dedicado para processar eventos de Transferências (Saques) aprovadas ou falhas.
 * Ele ouve a fila 'payment-processing' e filtra pelos eventos de TRANSFER (saques).
 */
function startPayoutWorker() {
    console.log('[Worker-Payouts] 🎧 Iniciando worker de saques...');

    const worker = new Worker('payment-processing', async (job) => {
        const { eventType, correlationId, payload } = job.data;

        // Se não for evento de transferência, ignora e deixa pro processPayment.js (ou vice-versa limpo depois)
        if (!eventType.startsWith('OPENPIX:TRANSFER') && eventType !== 'transfer.completed' && eventType !== 'transfer.failed') {
            return;
        }

        console.log(`[Worker-Payouts] Processando evento: ${eventType} para ${correlationId}`);

        try {
            await db.transaction(async (trx) => {
                // 1) Pega o Payout pendente (com lock)
                const payout = await trx('payouts')
                    .where('correlation_id', correlationId)
                    .forUpdate()
                    .first();

                if (!payout) {
                    throw new Error(`Payout ${correlationId} não encontrado no banco`);
                }

                if (payout.status !== 'pending') {
                    console.log(`[Worker-Payouts] Payout ${correlationId} ignorado (status já é ${payout.status})`);
                    return;
                }

                const isCompleted = eventType === 'OPENPIX:TRANSFER_COMPLETED' || eventType === 'transfer.completed';
                const isFailed = eventType === 'OPENPIX:TRANSFER_FAILED' || eventType === 'transfer.failed';

                if (isCompleted) {
                    // SUCESSO! O dinheiro realmente saiu pela Woovi.
                    // Libera o dinheiro da conta de garantia (escrow) e joga pro ar (conta de liquidação externa).
                    await ledger.resolvePayout({
                        amount: payout.amount,
                        payoutId: payout.id,
                        idempotencyKey: `payout_ok_${payout.id}`
                    });

                    await trx('payouts')
                        .where('id', payout.id)
                        .update({ status: 'completed', completed_at: new Date() });

                    console.log(`[Worker-Payouts] ✅ Saque ${correlationId} EFETIVADO no Ledger!`);

                    const telegram = require('../services/telegram');
                    await telegram.sendMessage(
                        `💸 <b>Saque efetivado!</b>\nValor: R$ ${(payout.amount / 100).toFixed(2)}\nID: <code>${payout.id}</code>`
                    );
                }
                else if (isFailed) {
                    // FALHA (ex: Chave pix recusada pela conta destino ou banco central)
                    // Pega o dinheiro do escrow e DEVOLVE pra conta do Lojista.
                    const merchant = await trx('merchants').where('id', payout.merchant_id).first();
                    if (!merchant) throw new Error('Merchant sumiu da base!?');

                    await ledger.rejectPayout({
                        merchantAccountId: merchant.account_id,
                        amount: payout.amount,
                        payoutId: payout.id,
                        idempotencyKey: `payout_fail_${payout.id}`
                    });

                    await trx('payouts')
                        .where('id', payout.id)
                        .update({ status: 'failed', completed_at: new Date() });

                    console.error(`[Worker-Payouts] ❌ Saque ${correlationId} FALHOU! Saldo estornado para o lojista.`);
                }

            }); // end trx

        } catch (err) {
            console.error(`[Worker-Payouts] Erro no job ${job.id}:`, err.message);
            throw err; // Força retry pelo BullMQ se for deadlock temporário
        }
    }, { connection });

    worker.on('failed', (job, err) => {
        console.error(`[Worker-Payouts] 🔴 Job Falhou (vai tentar de novo) ${job?.id}: ${err.message}`);
    });

    return worker;
}

module.exports = { startPayoutWorker };
