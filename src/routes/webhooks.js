const crypto = require('crypto');
const config = require('../config');
const db = require('../database/connection');
const { Queue } = require('bullmq');
const redis = require('../redis');

// Filas BullMQ
const paymentQueue = new Queue('payment-processing', { connection: redis });
const webhookDispatchQueue = new Queue('webhook-dispatch', { connection: redis });

/**
 * Valida a assinatura HMAC-SHA256 do webhook da Woovi.
 */
function validateSignature(payload, signature) {
    if (!signature || !config.woovi.webhookSecret) return false;

    const expected = crypto
        .createHmac('sha256', config.woovi.webhookSecret)
        .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
        .digest('hex');

    try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}

/**
 * Rota: POST /webhooks/woovi
 * Recebe webhooks da Woovi, persiste e enfileira para processamento.
 */
async function wooviWebhookHandler(request, reply) {
    const payload = request.body;

    // 0) Responde ao ping de validação da Woovi (body vazio ou evento especial)
    if (!payload || !payload.event || payload.event === 'ping' || payload.event === 'webhook_validation' || payload.evento === 'teste_webhook') {
        request.log.info({ body: payload }, 'Webhook ping/teste recebido — respondendo 200');
        return reply.status(200).send({ status: 'ok' });
    }

    const signature = request.headers['x-openpix-signature'] || request.headers['x-webhook-signature'];

    // 1) Validar assinatura (se secret configurado)
    if (config.woovi.webhookSecret && !validateSignature(payload, signature)) {
        request.log.warn('Webhook com assinatura inválida rejeitado');
        return reply.status(401).send({ error: 'Invalid signature' });
    }

    const eventType = payload.event || 'unknown';
    const charge = payload.charge || {};
    const correlationId = charge.correlationID || payload.pix?.correlationID || 'unknown';

    // 2) Persistir evento raw (idempotente via UNIQUE INDEX)
    try {
        await db('webhook_events').insert({
            source: 'woovi',
            event_type: eventType,
            correlation_id: correlationId,
            payload: JSON.stringify(payload),
            signature: signature || null,
            status: 'received',
        }).onConflict(['source', 'correlation_id', 'event_type']).ignore();
    } catch (err) {
        // Se for duplicata, ignora silenciosamente
        if (err.code === '23505') {
            request.log.info(`Webhook duplicado ignorado: ${eventType} ${correlationId}`);
            return reply.status(200).send({ status: 'duplicate' });
        }
        throw err;
    }

    // 3) Enfileira para processamento assíncrono
    await paymentQueue.add('process-webhook', {
        eventType,
        correlationId,
        payload,
    }, {
        jobId: `${eventType}_${correlationId}`, // evita duplicação na fila também
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
    });

    // 4) Retorna 200 imediato (não bloqueia a Woovi)
    request.log.info(`Webhook recebido e enfileirado: ${eventType} ${correlationId}`);
    return reply.status(200).send({ status: 'received' });
}

module.exports = { wooviWebhookHandler, validateSignature, paymentQueue, webhookDispatchQueue };
