const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/connection');

/**
 * Endpoints administrativos protegidos pela DASHBOARD_API_KEY.
 * Servem para o dono da plataforma (BISTECA) gerenciar os Bistecos (Lojistas).
 */
async function adminRoutes(app) {
    // Middleware de autenticação Admin
    app.addHook('preHandler', async (request, reply) => {
        const adminKey = request.headers['authorization'] || request.headers['x-api-key'];
        const configuredKey = process.env.DASHBOARD_API_KEY;

        if (!configuredKey || adminKey !== configuredKey) {
            request.log.warn('Tentativa de acesso admin não autorizada');
            return reply.status(401).send({ error: 'Unauthorized admin access' });
        }
    });

    // ==========================================
    // Listar todos os Bistecos
    // ==========================================
    app.get('/merchants', async (request, reply) => {
        const merchants = await db('merchants')
            .select('id', 'name', 'email', 'api_key_prefix', 'webhook_url', 'pix_key', 'pix_key_type', 'is_active', 'created_at')
            .orderBy('created_at', 'desc');

        // Buscar saldos
        const balances = await db('account_balances');
        const balanceMap = balances.reduce((acc, b) => {
            acc[b.account_id] = b.balance;
            return acc;
        }, {});

        // Ligar saldo ao merchant (via conta)
        const accounts = await db('accounts').where('owner_type', 'merchant');
        const accountMap = accounts.reduce((acc, a) => {
            acc[a.owner_id] = a.id;
            return acc;
        }, {});

        const result = merchants.map(m => {
            const accId = accountMap[m.id];
            return {
                ...m,
                balance: accId && balanceMap[accId] ? balanceMap[accId] : 0
            };
        });

        return { merchants: result };
    });

    // ==========================================
    // Criar um novo Bisteco
    // ==========================================
    app.post('/merchants', async (request, reply) => {
        const { name, email, webhookUrl, pixKey, pixKeyType } = request.body;

        if (!name || !email) {
            return reply.status(400).send({ error: 'Name and email are required' });
        }

        // Verifica se email já existe
        const existing = await db('merchants').where({ email }).first();
        if (existing) {
            return reply.status(409).send({ error: 'Email already in use' });
        }

        // Gera API Key
        // Formato: bst_live_[random hex]
        const rawApiKey = `bst_live_${crypto.randomBytes(32).toString('hex')}`;
        const apiKeyHash = await bcrypt.hash(rawApiKey, 10);
        const apiKeyPrefix = rawApiKey.substring(0, 16);

        try {
            const result = await db.transaction(async (trx) => {
                // 1) Cria Merchant
                const [merchant] = await trx('merchants').insert({
                    name,
                    email,
                    api_key_hash: apiKeyHash,
                    api_key_prefix: apiKeyPrefix,
                    webhook_url: webhookUrl || null,
                    pix_key: pixKey || null,
                    pix_key_type: pixKeyType || null
                }).returning('*');

                // 2) Cria Conta (Account)
                const [account] = await trx('accounts').insert({
                    owner_type: 'merchant',
                    owner_id: merchant.id
                }).returning('*');

                // 3) Associa Conta ao Merchant
                await trx('merchants')
                    .where('id', merchant.id)
                    .update({ account_id: account.id });

                return merchant;
            });

            // Retorna a CHAVE CRUA apenas uma vez!
            return reply.status(201).send({
                message: 'Bisteco created successfully',
                merchant: {
                    id: result.id,
                    name: result.name,
                    email: result.email,
                },
                api_key: rawApiKey, // IMPORTANTE: Única vez que isso é retornado
                warning: 'Please save the api_key, it cannot be retrieved again.'
            });

        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to create Bisteco' });
        }
    });
}

module.exports = adminRoutes;
