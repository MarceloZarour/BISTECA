const crypto = require('crypto');
const config = require('../config');
const db = require('../database/connection');
const { Queue } = require('bullmq');
const redis = require('../redis');

// Filas BullMQ
const paymentQueue = new Queue('payment-processing', { connection: redis });
const webhookDispatchQueue = new Queue('webhook-dispatch', { connection: redis });

/**
 * Valida a autenticação do webhook da Woovi/OpenPix.
 *
 * A OpenPix suporta dois mecanismos:
 * 1. Authorization header: quando o webhook é criado com o campo `authorization`,
 *    a OpenPix envia esse valor no header `Authorization` de cada chamada.
 * 2. HMAC-SHA256: assinatura sobre o raw body no header `x-openpix-signature`.
 *
 * Esta função tenta ambos, aceitando qualquer um que seja válido.
 */
function validateWebhookAuth(request) {
    if (!config.woovi.webhookSecret) return true; // sem secret configurado — aceita tudo

    // Mecanismo 1: Authorization header (campo `authorization` na criação do webhook)
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader === config.woovi.webhookSecret) return true;

    // Mecanismo 2: HMAC-SHA256 sobre o raw body
    const signature = request.headers['x-openpix-signature'] || request.headers['x-webhook-signature'];
    if (signature && request.rawBody != null) {
        const expected = crypto
            .createHmac('sha256', config.woovi.webhookSecret)
            .update(request.rawBody) // raw body original, não re-serializado
            .digest('hex');
        try {
            return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
        } catch {
            return false;
        }
    }

    return false;
}

// Mantida por compatibilidade com testes unitários existentes
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

    // 1) Validar autenticação (Authorization header ou HMAC-SHA256)
    if (!validateWebhookAuth(request)) {
        request.log.warn({
            authHeader: request.headers['authorization'] ? 'present' : 'absent',
            sigHeader: request.headers['x-openpix-signature'] || request.headers['x-webhook-signature'] ? 'present' : 'absent',
        }, 'Webhook com autenticação inválida rejeitado');
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
            signature: request.headers['x-openpix-signature'] || request.headers['x-webhook-signature'] || null,
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
