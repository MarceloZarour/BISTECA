const crypto = require('crypto');
const db = require('../database/connection');

async function getSettings() {
    const keys = ['bot_token', 'bot_msg_welcome', 'bot_msg_charge', 'bot_msg_success', 'bot_msg_expired', 'bot_price', 'bot_merchant_id'];
    const rows = await db('platform_settings').whereIn('key', keys);
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function sendMessage(token, chatId, text, replyMarkup) {
    try {
        const body = { chat_id: chatId, text, parse_mode: 'HTML' };
        if (replyMarkup) body.reply_markup = replyMarkup;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    } catch (e) {
        console.error('[TelegramBot] Falha ao enviar mensagem:', e.message);
    }
}

async function answerCallbackQuery(token, callbackQueryId) {
    try {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId }),
        });
    } catch (e) { /* silent */ }
}

async function handleMessage(message, settings) {
    if (!message?.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === '/start' || text.startsWith('/start ')) {
        const priceReais = parseFloat(settings.bot_price || '0');
        const priceFormatado = priceReais > 0
            ? `R$ ${priceReais.toFixed(2).replace('.', ',')}`
            : null;

        const welcome = settings.bot_msg_welcome || 'Bem-vindo! Clique no botão abaixo para adquirir seu acesso.';

        const replyMarkup = priceFormatado ? {
            inline_keyboard: [[{ text: `💳 Comprar por ${priceFormatado}`, callback_data: 'buy' }]],
        } : null;

        await sendMessage(settings.bot_token, chatId, welcome, replyMarkup);
        console.log(`[TelegramBot] /start → boas-vindas para ${chatId}`);
    }
}

async function handleCallbackQuery(callbackQuery, settings) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    await answerCallbackQuery(settings.bot_token, callbackQuery.id);

    if (data === 'buy') {
        const priceReais = parseFloat(settings.bot_price || '0');
        const merchantId = settings.bot_merchant_id;

        if (!priceReais || priceReais <= 0 || !merchantId) {
            await sendMessage(settings.bot_token, chatId, '❌ Bot não configurado. Entre em contato com o suporte.');
            return;
        }

        const priceCentavos = Math.round(priceReais * 100);
        const correlationID = crypto.randomUUID();

        try {
            const woovi = require('../services/woovi');
            const wooviResponse = await woovi.createCharge({
                value: priceCentavos,
                correlationID,
                expiresIn: 3600,
            });

            await db('charges').insert({
                correlation_id: correlationID,
                merchant_id: merchantId,
                value: priceCentavos,
                status: 'pending',
                br_code: wooviResponse.brCode,
                qr_code_image: wooviResponse.charge?.qrCodeImage || null,
                payment_link_url: wooviResponse.charge?.paymentLinkUrl || null,
                woovi_global_id: wooviResponse.charge?.globalID || null,
                expires_at: wooviResponse.charge?.expiresDate || null,
                bot_chat_id: String(chatId),
            });

            const valorFormatado = `R$ ${priceReais.toFixed(2).replace('.', ',')}`;
            const chargeMsg = (settings.bot_msg_charge || '💳 Valor: {valor}\n\nCopie o código PIX:\n{pix_code}\n\n⏳ Expira em 1 hora.')
                .replace('{valor}', valorFormatado)
                .replace('{pix_code}', wooviResponse.brCode);

            await sendMessage(settings.bot_token, chatId, chargeMsg);
            console.log(`[TelegramBot] PIX gerado para chatId ${chatId}: ${correlationID}`);

        } catch (err) {
            console.error('[TelegramBot] Erro ao gerar cobrança:', err.message);
            await sendMessage(settings.bot_token, chatId, '❌ Erro ao gerar cobrança. Tente novamente em instantes.');
        }
    }
}

async function startTelegramBot() {
    console.log('[TelegramBot] Bot de vendas iniciado (polling)');
    let offset = 0;

    while (true) {
        try {
            const settings = await getSettings();

            if (!settings.bot_token) {
                await new Promise(r => setTimeout(r, 10000));
                continue;
            }

            const res = await fetch(
                `https://api.telegram.org/bot${settings.bot_token}/getUpdates?offset=${offset}&timeout=25&allowed_updates=["message","callback_query"]`,
                { signal: AbortSignal.timeout(30000) }
            );

            if (!res.ok) {
                console.error('[TelegramBot] HTTP error:', res.status);
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            const data = await res.json();

            if (!data.ok) {
                if (data.error_code === 409) {
                    console.log('[TelegramBot] Conflito com webhook, removendo...');
                    await fetch(`https://api.telegram.org/bot${settings.bot_token}/deleteWebhook`);
                } else {
                    console.error('[TelegramBot] API error:', data.description);
                }
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            for (const update of data.result) {
                offset = update.update_id + 1;
                if (update.message) {
                    await handleMessage(update.message, settings);
                } else if (update.callback_query) {
                    await handleCallbackQuery(update.callback_query, settings);
                }
            }

        } catch (err) {
            if (err.name !== 'AbortError' && err.name !== 'TimeoutError') {
                console.error('[TelegramBot] Error:', err.message);
            }
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

module.exports = { startTelegramBot };
