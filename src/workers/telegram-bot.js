const db = require('../database/connection');

async function getSettings() {
    const keys = ['bot_token', 'bot_msg_welcome', 'bot_msg_charge', 'bot_msg_success', 'bot_msg_expired'];
    const rows = await db('platform_settings').whereIn('key', keys);
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function sendMessage(token, chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
    } catch (e) {
        console.error('[TelegramBot] Falha ao enviar mensagem:', e.message);
    }
}

async function handleUpdate(update, settings) {
    const message = update.message;
    if (!message?.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === '/start' || text.startsWith('/start ')) {
        const welcome = settings.bot_msg_welcome || 'Bem-vindo! Entre em contato para mais informações.';
        await sendMessage(settings.bot_token, chatId, welcome);
        console.log(`[TelegramBot] /start → enviou boas-vindas para ${chatId}`);
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
                `https://api.telegram.org/bot${settings.bot_token}/getUpdates?offset=${offset}&timeout=25&allowed_updates=["message"]`,
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
                    // Conflito com webhook existente — remove
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
                await handleUpdate(update, settings);
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
