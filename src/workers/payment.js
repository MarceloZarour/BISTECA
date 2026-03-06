const { Worker } = require('bullmq');
const redis = require('../redis');
const db = require('../database/connection');
const ledger = require('../services/ledger');
const config = require('../config');

/**
 * Worker que processa webhooks de pagamento confirmado.
 * Consome da fila 'payment-processing'.
 */
function startPaymentWorker() {
    const worker = new Worker('payment-processing', async (job) => {
        const { eventType, correlationId, payload } = job.data;

        console.log(`[Worker] Processando evento: ${eventType} | ${correlationId}`);

        // Marca evento como "processing"
        await db('webhook_events')
            .where({ source: 'woovi', correlation_id: correlationId, event_type: eventType })
            .update({ status: 'processing' });

        try {
            switch (eventType) {
                case 'OPENPIX:CHARGE_COMPLETED': {
                    await handleChargeCompleted(correlationId, payload);
                    break;
                }
                case 'OPENPIX:CHARGE_EXPIRED': {
                    await handleChargeExpired(correlationId);
                    break;
                }
                default:
                    console.log(`[Worker] Evento ignorado: ${eventType}`);
            }

            // Marca como processado
            await db('webhook_events')
                .where({ source: 'woovi', correlation_id: correlationId, event_type: eventType })
                .update({ status: 'processed', processed_at: new Date() });

        } catch (err) {
            // Marca como falho
            await db('webhook_events')
                .where({ source: 'woovi', correlation_id: correlationId, event_type: eventType })
                .update({ status: 'failed', error: err.message });

            throw err; // Re-throw para o BullMQ fazer retry
        }
    }, {
        connection: redis,
        concurrency: 5,
    });

    worker.on('completed', (job) => {
        console.log(`[Worker] Job ${job.id} concluído`);
    });

    worker.on('failed', (job, err) => {
        console.error(`[Worker] Job ${job?.id} falhou:`, err.message);
    });

    console.log('[Worker] Payment processing worker iniciado');
    return worker;
}

/**
 * Processa um pagamento confirmado (CHARGE_COMPLETED).
 */
async function handleChargeCompleted(correlationId, payload) {
    // 1) Busca a cobrança no nosso banco
    const charge = await db('charges')
        .where({ correlation_id: correlationId })
        .first();

    if (!charge) {
        console.warn(`[Worker] Cobrança não encontrada: ${correlationId}`);
        return;
    }

    if (charge.status === 'paid') {
        console.info(`[Worker] Cobrança já paga, ignorando: ${correlationId}`);
        return;
    }

    // 2) Busca o merchant desta cobrança
    const merchant = await db('merchants').where('id', charge.merchant_id).first();
    if (!merchant) {
        throw new Error(`Merchant não encontrado para charge ${correlationId}`);
    }

    // 3) Processa no ledger (double-entry)
    const result = await ledger.processPayment({
        chargeId: correlationId,
        merchantAccountId: merchant.account_id,
        amount: charge.value,
        feeRate: Number(merchant.fee_rate) || config.platform.feeRate,
        idempotencyKey: `charge_${correlationId}`,
    });

    // 4) Atualiza status da cobrança
    await db('charges')
        .where({ correlation_id: correlationId })
        .update({
            status: 'paid',
            paid_at: new Date(),
        });

    // 4b) Notifica bot de vendas Telegram (cobranças geradas pelo bot)
    if (charge.bot_chat_id) {
        console.log(`[Worker] Enviando confirmação Telegram para chatId ${charge.bot_chat_id}`);
        const settingRows = await db('platform_settings').whereIn('key', ['bot_token', 'bot_msg_success']);
        const s = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
        if (s.bot_token) {
            const msg = s.bot_msg_success || '✅ Pagamento confirmado! Obrigado pela compra. Você receberá o acesso em instantes. 🎉';
            fetch(`https://api.telegram.org/bot${s.bot_token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: charge.bot_chat_id, text: msg, parse_mode: 'HTML' }),
            }).then(r => console.log(`[Worker] Telegram notificado: ${r.status}`))
              .catch(e => console.error('[Worker] Falha ao notificar Telegram:', e.message));
        } else {
            console.warn('[Worker] bot_token não configurado — notificação Telegram ignorada');
        }
    }

    // 5) Enfileira webhook para o Bot do merchant
    const { Queue } = require('bullmq');
    const webhookDispatchQueue = new Queue('webhook-dispatch', { connection: redis });

    await webhookDispatchQueue.add('dispatch', {
        merchantId: merchant.id,
        webhookUrl: merchant.webhook_url,
        event: 'charge.paid',
        data: {
            correlationID: correlationId,
            value: charge.value,
            paidAt: new Date().toISOString(),
            metadata: charge.metadata
                ? (typeof charge.metadata === 'string' ? JSON.parse(charge.metadata) : charge.metadata)
                : null,
        },
    }, {
        attempts: 8,
        backoff: { type: 'exponential', delay: 1000 },
    });

    console.log(`[Worker] Pagamento processado: ${correlationId} | Merchant: ${merchant.name} | Valor: R$ ${(charge.value / 100).toFixed(2)}`);

    const telegram = require('../services/telegram');
    await telegram.sendMessage(
        `✅ <b>Pagamento confirmado!</b>\nMerchant: <b>${merchant.name}</b>\nValor: R$ ${(charge.value / 100).toFixed(2)}\nID: <code>${correlationId}</code>`
    );
}

/**
 * Processa expiração de cobrança.
 */
async function handleChargeExpired(correlationId) {
    const charge = await db('charges').where({ correlation_id: correlationId, status: 'pending' }).first();

    await db('charges')
        .where({ correlation_id: correlationId, status: 'pending' })
        .update({ status: 'expired' });

    console.log(`[Worker] Cobrança expirada: ${correlationId}`);

    // Notifica bot de vendas Telegram (cobranças geradas pelo bot)
    if (charge?.bot_chat_id) {
        const settingRows = await db('platform_settings').whereIn('key', ['bot_token', 'bot_msg_expired']);
        const s = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
        if (s.bot_token) {
            const msg = s.bot_msg_expired || '⌛ Seu PIX expirou. Envie /start para gerar um novo código.';
            fetch(`https://api.telegram.org/bot${s.bot_token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: charge.bot_chat_id, text: msg, parse_mode: 'HTML' }),
            }).catch(e => console.error('[Worker] Falha ao notificar Telegram:', e.message));
        }
    }
}

module.exports = { startPaymentWorker, handleChargeCompleted };
