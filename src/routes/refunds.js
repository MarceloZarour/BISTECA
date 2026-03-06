const crypto = require('crypto');
const db = require('../database/connection');
const woovi = require('../services/woovi');
const ledger = require('../services/ledger');

async function refundsRoutes(app) {
    // Middleware de autenticação JWT
    app.addHook('preHandler', app.authenticate);
    app.addHook('preHandler', async (request, reply) => {
        const merchant = await db('merchants').where('id', request.user.id).first();
        if (!merchant) return reply.status(404).send({ error: 'Lojista não encontrado' });
        request.merchantId = merchant.id;
        request.merchantAccountId = merchant.account_id;
        request.merchant = merchant;
    });

    // ==========================================
    // GET / - Lista reembolsos do lojista
    // ==========================================
    app.get('/', async (request, reply) => {
        const refunds = await db('refunds')
            .where('merchant_id', request.merchantId)
            .orderBy('created_at', 'desc')
            .limit(50);

        return { refunds };
    });

    // ==========================================
    // POST / - Solicita reembolso de uma cobrança
    // ==========================================
    app.post('/', async (request, reply) => {
        const { chargeCorrelationId, value, comment } = request.body || {};

        if (!chargeCorrelationId) {
            return reply.status(400).send({ error: 'chargeCorrelationId é obrigatório' });
        }

        // 1) Valida a cobrança: existe, pertence ao merchant e está paga
        const charge = await db('charges')
            .where({ correlation_id: chargeCorrelationId, merchant_id: request.merchantId })
            .first();

        if (!charge) {
            return reply.status(404).send({ error: 'Cobrança não encontrada' });
        }

        if (charge.status !== 'paid') {
            return reply.status(422).send({ error: 'Só é possível reembolsar cobranças com status "paid"' });
        }

        // 2) Verifica duplicata (evita dois reembolsos da mesma cobrança)
        const existing = await db('refunds')
            .where('charge_correlation_id', chargeCorrelationId)
            .whereNot('status', 'failed')
            .first();

        if (existing) {
            return reply.status(409).send({ error: 'Já existe um reembolso para esta cobrança', refundId: existing.id });
        }

        // 3) Valor do reembolso
        const refundAmount = value ? parseInt(value, 10) : charge.value;

        if (refundAmount <= 0 || refundAmount > charge.value) {
            return reply.status(400).send({ error: `Valor inválido. Máximo: ${charge.value} centavos` });
        }

        const refundId = crypto.randomUUID();
        const refundCorrelationId = `refund_${refundId}`;

        // 4) Chama Woovi
        try {
            await woovi.refundCharge(chargeCorrelationId, {
                correlationID: refundCorrelationId,
                value: refundAmount,
                comment: comment || undefined,
            });
        } catch (err) {
            request.log.error(err, 'Erro ao reembolsar na Woovi');
            return reply.status(502).send({ error: 'Falha ao processar reembolso na Woovi', details: err.data || err.message });
        }

        // 5) Registra no banco
        await db('refunds').insert({
            id: refundId,
            merchant_id: request.merchantId,
            charge_correlation_id: chargeCorrelationId,
            refund_correlation_id: refundCorrelationId,
            value: refundAmount,
            status: 'completed',
            comment: comment || null,
        });

        // 6) Atualiza status da cobrança original para 'refunded'
        await db('charges')
            .where('correlation_id', chargeCorrelationId)
            .update({ status: 'refunded' });

        // 7) Ajusta ledger (estorna merchant e plataforma, credita escrow)
        try {
            await ledger.processRefund({
                refundId,
                merchantAccountId: request.merchantAccountId,
                amount: refundAmount,
                feeRate: Number(request.merchant.fee_rate) || 0.05,
                idempotencyKey: `refund_${refundId}`,
            });
        } catch (err) {
            request.log.error(err, 'Erro ao processar reembolso no ledger (reembolso Woovi já foi feito)');
            // Não reverte o reembolso Woovi, apenas loga o erro de ledger
        }

        const refund = await db('refunds').where('id', refundId).first();
        return reply.status(201).send({ message: 'Reembolso processado com sucesso', refund });
    });
}

module.exports = refundsRoutes;
