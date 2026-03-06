const { Worker } = require('bullmq');
const redis = require('../redis');
const config = require('../config');

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
    }, {
        connection: redis,
        concurrency: 10,
    });

    worker.on('completed', (job) => {
        console.log(`[Dispatcher] Job ${job.id} entregue`);
    });

    worker.on('failed', (job, err) => {
        console.error(`[Dispatcher] Job ${job?.id} falhou (attempt ${job?.attemptsMade}):`, err.message);
    });

    console.log('[Dispatcher] Webhook dispatcher iniciado');
    return worker;
}

module.exports = { startWebhookDispatcher };
