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
async function authMiddleware(request, reply) {
    const apiKey = request.headers['authorization'];

    if (!apiKey) {
        return reply.status(401).send({ error: 'API key obrigatória no header Authorization' });
    }

    // Busca merchant pelo prefixo da key (primeiros 9 chars: "bst_live_" ou "bst_test_")
    const merchants = await db('merchants').where('is_active', true).select('*');

    let authenticatedMerchant = null;
    for (const merchant of merchants) {
        const isValid = await bcrypt.compare(apiKey, merchant.api_key_hash);
        if (isValid) {
            authenticatedMerchant = merchant;
            break;
        }
    }

    if (!authenticatedMerchant) {
        return reply.status(401).send({ error: 'API key inválida' });
    }

    // Injeta o merchant no request para uso nas rotas
    request.merchantId = authenticatedMerchant.id;
    request.merchantAccountId = authenticatedMerchant.account_id;
    request.merchant = authenticatedMerchant;
}

module.exports = { authMiddleware, generateApiKey };
