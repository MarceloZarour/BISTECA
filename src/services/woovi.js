const config = require('../config');

const BASE_URL = config.woovi.apiUrl;

/**
 * Faz uma requisição autenticada para a API da Woovi.
 */
async function wooviRequest(method, path, body = null) {
    const url = `${BASE_URL}${path}`;
    const headers = {
        'Authorization': config.woovi.appId,
        'Content-Type': 'application/json',
    };

    const options = { method, headers };
    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
        const error = new Error(`Woovi API error: ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

/**
 * Cria uma cobrança Pix na Woovi.
 * @param {Object} params
 * @param {number} params.value - Valor em centavos (ex: 1500 = R$ 15,00)
 * @param {string} params.correlationID - ID único desta cobrança
 * @param {number} [params.expiresIn] - Segundos até expirar (padrão: 86400 = 24h)
 * @param {Array} [params.splits] - Array de splits [{pixKey, value}]
 * @returns {Promise<Object>} Dados da cobrança criada (inclui brCode, qrCodeImage, etc.)
 */
async function createCharge({ value, correlationID, expiresIn, splits, customer }) {
    const body = { value, correlationID };

    if (expiresIn) body.expiresIn = expiresIn;
    if (splits && splits.length > 0) body.splits = splits;
    if (customer) body.customer = customer;

    return wooviRequest('POST', '/api/v1/charge', body);
}

/**
 * Busca o status de uma cobrança na Woovi.
 * @param {string} correlationID
 */
async function getCharge(correlationID) {
    return wooviRequest('GET', `/api/v1/charge/${correlationID}`);
}

/**
 * Cria uma transferência Pix (payout) na Woovi.
 * @param {Object} params
 * @param {number} params.value - Valor em centavos
 * @param {string} params.pixKey - Chave PIX do recebedor (telefone, cpf, email, aleatoria)
 * @param {string} [params.pixKeyType] - Tipo da chave (CPF, CNPJ, EMAIL, PHONE, RANDOM)
 * @param {string} [params.correlationID] - (Opcional) Identificador único para idempotência 
 */
async function createTransfer({ value, pixKey, pixKeyType, correlationID }) {
    const body = { value, pixKey };
    if (pixKeyType) body.pixKeyType = pixKeyType;
    if (correlationID) body.correlationID = correlationID;

    return wooviRequest('POST', '/api/v1/transfer', body);
}

/**
 * Reembolsa uma cobrança (total ou parcial).
 * @param {string} chargeCorrelationID - correlationID da cobrança original
 * @param {Object} params
 * @param {string} params.correlationID - ID único do reembolso
 * @param {number} [params.value] - Valor parcial em centavos (omitir = reembolso total)
 * @param {string} [params.comment]
 */
async function refundCharge(chargeCorrelationID, { correlationID, value, comment }) {
    const body = { correlationID };
    if (value) body.value = value;
    if (comment) body.comment = comment;

    return wooviRequest('POST', `/api/v1/charge/${chargeCorrelationID}/refund`, body);
}

/**
 * Cria uma subconta virtual na Woovi.
 */
async function createSubaccount({ name, pixKey }) {
    return wooviRequest('POST', '/api/v1/subaccount', { name, pixKey });
}

/**
 * Consulta saldo de uma conta.
 */
async function getAccountBalance(accountId) {
    return wooviRequest('GET', `/api/v1/account/${accountId}`);
}

/**
 * Lista transações com filtros opcionais.
 */
async function listTransactions(params = {}) {
    const query = new URLSearchParams(params).toString();
    const path = query ? `/api/v1/transaction?${query}` : '/api/v1/transaction';
    return wooviRequest('GET', path);
}

/**
 * Registra um webhook na Woovi.
 */
async function createWebhook({ url, event, name, authorization }) {
    const body = { url, event, name };
    if (authorization) body.authorization = authorization;
    return wooviRequest('POST', '/api/v1/webhook', body);
}

module.exports = {
    createCharge,
    getCharge,
    createTransfer,
    refundCharge,
    createSubaccount,
    getAccountBalance,
    listTransactions,
    createWebhook,
    wooviRequest,
};
