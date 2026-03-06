const db = require('../database/connection');

async function getConfig() {
    const rows = await db('platform_settings').whereIn('key', ['telegram_bot_token', 'telegram_chat_id']);
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return { token: map.telegram_bot_token, chatId: map.telegram_chat_id };
}

async function sendMessage(text) {
    const { token, chatId } = await getConfig();
    if (!token || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
    } catch (e) {
        console.warn('[Telegram] Falha ao enviar mensagem:', e.message);
    }
}

module.exports = { sendMessage, getConfig };
