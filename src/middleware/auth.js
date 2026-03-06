const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/connection');

/**
 * Gera uma API key com prefixo identificável.
 * Formato: bst_live_xxxxx ou bst_test_xxxxx
 */
function generateApiKey(environment = 'live') {
    const prefix = `bst_${environment}_`;
    const random = crypto.randomBytes(32).toString('hex');
    return `${prefix}${random}`;
}

/**
 * Middleware de autenticação.
 * Verifica a API key no header Authorization.
 */
async function apiKeyAuthMiddleware(request, reply) {
    const apiKey = request.headers['authorization'];

    if (!apiKey) {
        return reply.status(401).send({ error: 'API key obrigatória no header Authorization' });
    }

    // Usa o prefixo (primeiros 16 chars) para lookup rápido, depois verifica o hash
    const prefix = apiKey.substring(0, 16);
    if (!prefix.startsWith('bst_')) {
        return reply.status(401).send({ error: 'API key inválida' });
    }

    const merchant = await db('merchants').where({ api_key_prefix: prefix, is_active: true }).first();

    if (!merchant || !(await bcrypt.compare(apiKey, merchant.api_key_hash))) {
        return reply.status(401).send({ error: 'API key inválida' });
    }

    const authenticatedMerchant = merchant;

    // Injeta o merchant no request para uso nas rotas
    request.merchantId = authenticatedMerchant.id;
    request.merchantAccountId = authenticatedMerchant.account_id;
    request.merchant = authenticatedMerchant;
}

module.exports = { apiKeyAuthMiddleware, generateApiKey };
