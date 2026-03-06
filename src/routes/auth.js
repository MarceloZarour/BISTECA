const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database/connection');

async function authRoutes(app) {
    // ==========================================
    // POST /login - Autenticação por Email e Senha
    // ==========================================
    app.post('/login', async (request, reply) => {
        const { email, password } = request.body;

        if (!email || !password) {
            return reply.status(400).send({ error: 'Email and password are required' });
        }

        const merchant = await db('merchants').where({ email, is_active: true }).first();
        if (!merchant || !merchant.password_hash) {
            return reply.status(401).send({ error: 'Credenciais inválidas' });
        }

        const isValid = await bcrypt.compare(password, merchant.password_hash);
        if (!isValid) {
            return reply.status(401).send({ error: 'Credenciais inválidas' });
        }

        // Gera o JWT
        const token = app.jwt.sign({
            id: merchant.id,
            role: merchant.role,
            accountId: merchant.account_id
        }, { expiresIn: '7d' });

        return { token, role: merchant.role, name: merchant.name };
    });

    // ==========================================
    // POST /register - Cadastro Público de Lojistas
    // ==========================================
    app.post('/register', async (request, reply) => {
        const { name, email, password } = request.body;

        if (!name || !email || !password) {
            return reply.status(400).send({ error: 'Nome, email e senha são obrigatórios' });
        }
        if (password.length < 6) {
            return reply.status(400).send({ error: 'A senha deve ter pelo menos 6 caracteres' });
        }

        const existing = await db('merchants').where({ email }).first();
        if (existing) {
            return reply.status(409).send({ error: 'Email já está em uso' });
        }

        // Gera hashes
        const passHash = await bcrypt.hash(password, 10);
        const rawApiKey = `bst_live_${crypto.randomBytes(32).toString('hex')}`;
        const apiKeyHash = await bcrypt.hash(rawApiKey, 10);
        const apiKeyPrefix = rawApiKey.substring(0, 16);

        try {
            const result = await db.transaction(async (trx) => {
                const [merchant] = await trx('merchants').insert({
                    name,
                    email,
                    password_hash: passHash,
                    role: 'merchant',
                    api_key_hash: apiKeyHash,
                    api_key_prefix: apiKeyPrefix,
                    fee_rate: 0.05 // default 5% para self-service
                }).returning('*');

                const [account] = await trx('accounts').insert({
                    owner_type: 'merchant',
                    owner_id: merchant.id
                }).returning('*');

                await trx('merchants')
                    .where('id', merchant.id)
                    .update({ account_id: account.id });

                return merchant;
            });

            // Retorna a CHAVE CRUA no momento do cadastro e o JWT pra ele já entrar logado
            const token = app.jwt.sign({
                id: result.id,
                role: result.role,
                accountId: result.account_id
            }, { expiresIn: '7d' });

            return reply.status(201).send({
                message: 'Conta criada com sucesso',
                token,
                role: result.role,
                name: result.name,
                api_key: rawApiKey // IMPORTANTE: Lojista tem que salvar agora.
            });

        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Falha ao criar conta' });
        }
    });

    // ==========================================
    // GET /me - Retorna os dados da sessão atual
    // ==========================================
    app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
        const merchant = await db('merchants').where('id', request.user.id).first();
        if (!merchant) {
            return reply.status(404).send({ error: 'Usuário não encontrado' });
        }
        return {
            id: merchant.id,
            name: merchant.name,
            email: merchant.email,
            role: merchant.role,
            api_key_prefix: merchant.api_key_prefix
        };
    });
}

module.exports = authRoutes;
