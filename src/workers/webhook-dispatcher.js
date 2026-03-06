const { Worker } = require('bullmq');
const redis = require('../redis');
const config = require('../config');
const db = require('../database/connection');

/**
 * Worker que dispara webhooks para os Bots dos merchants.
 * Consome da fila 'webhook-dispatch'.
 */
function startWebhookDispatcher() {
    const worker = new Worker('webhook-dispatch', async (job) => {
        const { merchantId, webhookUrl, event, data } = job.data;

        if (!webhookUrl) {
            console.warn(`[Dispatcher] Merchant ${merchantId} sem webhook_url configurada, pulando`);
            return;
        }

        console.log(`[Dispatcher] Disparando webhook para ${webhookUrl} | Evento: ${event}`);

        const payload = {
            event,
            data,
            timestamp: new Date().toISOString(),
        };

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.webhookDispatch.timeoutMs),
        });

        if (!response.ok) {
            throw new Error(`Webhook dispatch falhou: ${response.status} ${response.statusText}`);
        }

        console.log(`[Dispatcher] Webhook entregue com sucesso para ${webhookUrl}`);

        await db('webhook_deliveries').insert({
            merchant_id: merchantId,
            charge_correlation_id: data?.correlationID || null,
            event,
            webhook_url: webhookUrl,
            status_code: response.status,
            attempt: job.attemptsMade + 1,
            status: 'success',
        }).catch(() => {});

        const telegram = require('../services/telegram');
        await telegram.sendMessage(
            `📤 <b>Webhook entregue</b>\nURL: ${webhookUrl}\nEvento: ${event}`
        );
    }, {
        connection: redis,
        concurrency: 10,
    });

    worker.on('completed', (job) => {
        console.log(`[Dispatcher] Job ${job.id} entregue`);
    });

    worker.on('failed', async (job, err) => {
        console.error(`[Dispatcher] Job ${job?.id} falhou (attempt ${job?.attemptsMade}):`, err.message);
        const { merchantId, webhookUrl, event, data } = job?.data || {};
        if (merchantId && webhookUrl) {
            await db('webhook_deliveries').insert({
                merchant_id: merchantId,
                charge_correlation_id: data?.correlationID || null,
                event: event || 'unknown',
                webhook_url: webhookUrl,
                status_code: null,
                attempt: (job?.attemptsMade || 0) + 1,
                status: 'failed',
                error: err.message,
            }).catch(() => {});
        }
    });

    console.log('[Dispatcher] Webhook dispatcher iniciado');
    return worker;
}

module.exports = { startWebhookDispatcher };
