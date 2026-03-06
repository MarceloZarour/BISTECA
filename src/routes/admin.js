const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/connection');

/**
 * Endpoints administrativos protegidos pela DASHBOARD_API_KEY.
 * Servem para o dono da plataforma (BISTECA) gerenciar os Bistecos (Lojistas).
 */
async function adminRoutes(app) {
    // Middleware de autenticação Admin via JWT
    app.addHook('preHandler', app.authenticate);
    app.addHook('preHandler', async (request, reply) => {
        if (request.user.role !== 'admin') {
            request.log.warn('Tentativa de acesso admin não autorizada');
            return reply.status(403).send({ error: 'Acesso negado: Requer privilégios de administrador' });
        }
    });

    // ==========================================
    // Listar todos os Bistecos
    // ==========================================
    app.get('/merchants', async (request, reply) => {
        const merchants = await db('merchants')
            .select('id', 'name', 'email', 'fee_rate', 'api_key_prefix', 'webhook_url', 'pix_key', 'pix_key_type', 'is_active', 'created_at')
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
        const { name, email, feeRate, webhookUrl, pixKey, pixKeyType } = request.body;

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
                const defaultPassHash = await bcrypt.hash('bisteca123', 10);

                // 1) Cria Merchant
                const [merchant] = await trx('merchants').insert({
                    name,
                    email,
                    fee_rate: feeRate ? parseFloat(feeRate) : 0.0500,
                    api_key_hash: apiKeyHash,
                    api_key_prefix: apiKeyPrefix,
                    webhook_url: webhookUrl || null,
                    pix_key: pixKey || null,
                    pix_key_type: pixKeyType || null,
                    password_hash: defaultPassHash,
                    role: 'merchant'
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

    // ==========================================
    // GET /settings - Configurações da plataforma
    // ==========================================
    const ALL_SETTINGS_KEYS = [
        'telegram_bot_token', 'telegram_chat_id',
        'bot_token', 'bot_test_chat_id',
        'bot_msg_welcome', 'bot_msg_charge', 'bot_msg_success', 'bot_msg_expired',
    ];

    app.get('/settings', async (request, reply) => {
        const rows = await db('platform_settings').whereIn('key', ALL_SETTINGS_KEYS);
        const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
        return {
            telegram_bot_token: map.telegram_bot_token ? '***' + map.telegram_bot_token.slice(-6) : null,
            telegram_chat_id: map.telegram_chat_id || null,
            bot_token: map.bot_token ? '***' + map.bot_token.slice(-6) : null,
            bot_test_chat_id: map.bot_test_chat_id || null,
            bot_msg_welcome: map.bot_msg_welcome || '',
            bot_msg_charge: map.bot_msg_charge || '',
            bot_msg_success: map.bot_msg_success || '',
            bot_msg_expired: map.bot_msg_expired || '',
        };
    });

    // ==========================================
    // PATCH /settings - Salva configurações da plataforma
    // ==========================================
    app.patch('/settings', async (request, reply) => {
        const allowed = [
            'telegram_bot_token', 'telegram_chat_id',
            'bot_token', 'bot_test_chat_id',
            'bot_msg_welcome', 'bot_msg_charge', 'bot_msg_success', 'bot_msg_expired',
        ];
        for (const key of allowed) {
            const value = request.body?.[key];
            if (value !== undefined) {
                await db('platform_settings')
                    .insert({ key, value, updated_at: new Date() })
                    .onConflict('key').merge();
            }
        }
        return { message: 'Configurações salvas' };
    });

    // ==========================================
    // POST /settings/test-telegram - Envia mensagem de teste (alertas admin)
    // ==========================================
    app.post('/settings/test-telegram', async (request, reply) => {
        const telegram = require('../services/telegram');
        const { token, chatId } = await telegram.getConfig();
        if (!token || !chatId) {
            return reply.status(400).send({ error: 'Telegram não configurado. Salve o token e o chat ID primeiro.' });
        }
        await telegram.sendMessage('🟢 <b>BISTECA</b> — Notificações Telegram configuradas com sucesso!');
        return { message: 'Mensagem de teste enviada' };
    });

    // ==========================================
    // POST /bot/test-message - Testa conexão do bot de vendas
    // ==========================================
    app.post('/bot/test-message', async (request, reply) => {
        const rows = await db('platform_settings').whereIn('key', ['bot_token', 'bot_test_chat_id']);
        const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

        if (!map.bot_token || !map.bot_test_chat_id) {
            return reply.status(400).send({ error: 'Salve o Token e o Chat ID de Testes primeiro.' });
        }

        try {
            const res = await fetch(`https://api.telegram.org/bot${map.bot_token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: map.bot_test_chat_id,
                    text: '🤖 <b>BISTECA</b> — Conexão com o bot de vendas funcionando!\n\nSeu bot está pronto para receber clientes.',
                    parse_mode: 'HTML',
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                return reply.status(400).send({ error: `Telegram API: ${data.description || 'Erro desconhecido'}` });
            }
            return { message: 'Mensagem de teste enviada com sucesso!' };
        } catch (err) {
            return reply.status(500).send({ error: `Falha ao conectar: ${err.message}` });
        }
    });
}

module.exports = adminRoutes;
