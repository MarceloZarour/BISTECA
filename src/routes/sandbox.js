const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/connection');
const woovi = require('../services/woovi');
const { handleChargeCompleted } = require('../workers/payment');

/**
 * Sandbox de Testes — apenas para administradores.
 * Permite criar cobranças reais e simular pagamentos sem Woovi.
 */
async function sandboxRoutes(app) {
    // Apenas admins
    app.addHook('preHandler', app.authenticate);
    app.addHook('preHandler', async (request, reply) => {
        if (request.user.role !== 'admin') {
            return reply.status(403).send({ error: 'Acesso negado' });
        }
    });

    // ==========================================
    // GET /merchant - Info do merchant sandbox
    // ==========================================
    app.get('/merchant', async (request, reply) => {
        const merchant = await getOrCreateSandboxMerchant();
        const balanceRow = await db('account_balances').where('account_id', merchant.account_id).first();
        return {
            id: merchant.id,
            name: merchant.name,
            email: merchant.email,
            balance: balanceRow ? parseInt(balanceRow.balance, 10) : 0,
        };
    });

    // ==========================================
    // POST /charge - Cria cobrança de teste
    // ==========================================
    app.post('/charge', async (request, reply) => {
        const { value = 1000 } = request.body || {};

        if (!value || value < 100) {
            return reply.status(400).send({ error: 'Valor mínimo: 100 centavos (R$ 1,00)' });
        }

        const merchant = await getOrCreateSandboxMerchant();
        const correlationId = `sandbox_${crypto.randomUUID()}`;

        // Cria cobrança real na Woovi
        const wooviRes = await woovi.createCharge({
            value,
            correlationID: correlationId,
            expiresIn: 3600,
        });

        // Salva no banco
        await db('charges').insert({
            correlation_id: correlationId,
            merchant_id: merchant.id,
            value,
            status: 'pending',
            metadata: JSON.stringify({ sandbox: true }),
        });

        return {
            correlationId,
            value,
            qrCode: wooviRes.charge?.qrCodeImage || null,
            pixCode: wooviRes.charge?.brCode || wooviRes.charge?.pixKey || null,
        };
    });

    // ==========================================
    // POST /simulate-payment - Simula pagamento sem Woovi
    // ==========================================
    app.post('/simulate-payment', async (request, reply) => {
        const { correlationId } = request.body || {};

        if (!correlationId) {
            return reply.status(400).send({ error: 'correlationId é obrigatório' });
        }

        const charge = await db('charges').where('correlation_id', correlationId).first();
        if (!charge) {
            return reply.status(404).send({ error: 'Cobrança não encontrada' });
        }
        if (charge.status === 'paid') {
            return reply.status(409).send({ error: 'Cobrança já foi paga' });
        }

        // Cria registro no webhook_events para não quebrar o worker
        const existing = await db('webhook_events')
            .where({ source: 'woovi', correlation_id: correlationId, event_type: 'OPENPIX:CHARGE_COMPLETED' })
            .first();
        if (!existing) {
            await db('webhook_events').insert({
                source: 'woovi',
                event_type: 'OPENPIX:CHARGE_COMPLETED',
                correlation_id: correlationId,
                payload: JSON.stringify({ sandbox: true }),
                status: 'pending',
            });
        }

        // Processa diretamente (sem BullMQ)
        await handleChargeCompleted(correlationId, { sandbox: true });

        return { success: true, message: 'Pagamento simulado com sucesso' };
    });
}

/**
 * Garante que o merchant sandbox existe, criando se necessário.
 */
async function getOrCreateSandboxMerchant() {
    let merchant = await db('merchants').where('email', 'sandbox@bisteca.internal').first();
    if (!merchant) {
        const hash = await bcrypt.hash('sandbox_disabled', 10);
        const result = await db.transaction(async (trx) => {
            const [m] = await trx('merchants').insert({
                name: 'Sandbox Test Merchant',
                email: 'sandbox@bisteca.internal',
                api_key_hash: hash,
                api_key_prefix: 'bst_sandbox',
                fee_rate: 0.05,
                password_hash: hash,
                role: 'merchant',
            }).returning('*');

            const [account] = await trx('accounts').insert({
                owner_type: 'merchant',
                owner_id: m.id,
            }).returning('*');

            await trx('merchants').where('id', m.id).update({ account_id: account.id });

            return trx('merchants').where('id', m.id).first();
        });
        merchant = result;
    }
    return merchant;
}

module.exports = sandboxRoutes;
