const db = require('../database/connection');
const woovi = require('../services/woovi');
const ledger = require('../services/ledger');
const crypto = require('crypto');

async function payoutsRoutes(app) {
    // Middleware de autenticação JWT
    app.addHook('preHandler', app.authenticate);
    app.addHook('preHandler', async (request, reply) => {
        const merchant = await db('merchants').where('id', request.user.id).first();
        if (!merchant) return reply.status(404).send({ error: 'Lojista não encontrado' });

        request.merchantId = merchant.id;
        request.merchantAccountId = merchant.account_id;
        request.merchant = merchant;
    });

    // Lista histórico de saques do lojista
    app.get('/', async (request, reply) => {
        const { merchant } = request;
        const limit = parseInt(request.query.limit) || 50;

        const payouts = await db('payouts')
            .where('merchant_id', merchant.id)
            .orderBy('created_at', 'desc')
            .limit(limit);

        return { payouts };
    });

    // Solicita um novo saque (transferência Pix)
    app.post('/', async (request, reply) => {
        const { merchant } = request;
        const { amount, pixKey, pixKeyType } = request.body;

        if (!amount || amount <= 0) {
            return reply.status(400).send({ error: 'Valid amount is required' });
        }

        if (!pixKey) {
            return reply.status(400).send({ error: 'pixKey is required' });
        }

        const payoutId = crypto.randomUUID();
        const correlationID = `payout_${payoutId}`;

        // 1) Reserva o saldo no Ledger (Double-Entry)
        try {
            await ledger.reserveForPayout({
                merchantAccountId: merchant.account_id,
                amount,
                payoutId,
                idempotencyKey: payoutId
            });
        } catch (err) {
            if (err.message === 'INSUFFICIENT_BALANCE') {
                return reply.status(422).send({ error: 'Insufficient balance available for this payout.' });
            }
            request.log.error(err);
            return reply.status(500).send({ error: 'Error reserving payout balance' });
        }

        // 2) Armazena o registro de saque no banco de dados como pendente
        await db('payouts').insert({
            id: payoutId,
            merchant_id: merchant.id,
            amount,
            pix_key: pixKey,
            pix_key_type: pixKeyType || null,
            correlation_id: correlationID,
            status: 'pending'
        });

        // 3) Chama a API da Woovi para iniciar o Payout efetivamente
        try {
            const wooviResponse = await woovi.createTransfer({
                value: amount,
                pixKey,
                pixKeyType,
                correlationID
            });

            // Conseguiu solicitar na Woovi, agora é só esperar o Webhook Assíncrono para concluir
            await db('payouts')
                .where('id', payoutId)
                .update({ woovi_response: JSON.stringify(wooviResponse) });

            return reply.status(201).send({
                message: 'Payout requested successfully. Awaiting processing.',
                payoutId,
                status: 'pending'
            });

        } catch (err) {
            request.log.error(`Woovi Transfer Error: ${err.message}`, err.data);

            // FADOU AO INICIAR TRANSFERÊNCIA (ex: chave pix inválida sintaticamente, woovi fora, limites API)
            // Precisamos cancelar imediatamente o saldo bloqueado
            await ledger.rejectPayout({
                merchantAccountId: merchant.account_id,
                amount,
                payoutId,
                idempotencyKey: `${payoutId}_sys_revert`
            });

            await db('payouts')
                .where('id', payoutId)
                .update({ status: 'failed', woovi_response: JSON.stringify(err.data || { error: err.message }) });

            return reply.status(400).send({
                error: 'Failed to initiate transfer at the payment provider.',
                details: err.data || err.message
            });
        }
    });

}

module.exports = payoutsRoutes;
