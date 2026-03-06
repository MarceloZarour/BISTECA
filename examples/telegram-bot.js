/**
 * 🤖 Bot Telegram de Exemplo — Integração com BISTECA Gateway
 *
 * Comandos:
 *   /start     → Mensagem de boas-vindas
 *   /comprar   → Gera um Pix de R$ 1,00 e envia o Copia e Cola
 *   /saldo     → Mostra o status do bot
 *
 * Fluxo:
 *   Usuário /comprar → Bot chama Gateway → Gateway chama Woovi → Pix gerado → Bot envia Copia e Cola
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

// Configurações
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const MERCHANT_API_KEY = process.env.MERCHANT_API_KEY;

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN não configurado no .env');
    process.exit(1);
}

if (!MERCHANT_API_KEY) {
    console.error('❌ MERCHANT_API_KEY não configurado no .env');
    process.exit(1);
}

// Inicia o bot em modo polling
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Armazena cobranças pendentes (correlationID → chatId) para entrega automática
const pendingCharges = new Map();

console.log('🤖 Bot do Telegram iniciado!');

// ═══════════════════════════════════════════════
// COMANDO: /start
// ═══════════════════════════════════════════════
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        '🎉 *Bem-vindo à loja BISTECA!*\n\n' +
        'Eu sou o bot de demonstração do gateway de pagamento.\n\n' +
        '📦 Comandos disponíveis:\n' +
        '  /comprar — Comprar produto de teste (R$ 1,00)\n' +
        '  /status — Ver status do bot\n\n' +
        '_Pagamento via Pix instantâneo!_',
        { parse_mode: 'Markdown' }
    );
});

// ═══════════════════════════════════════════════
// COMANDO: /comprar
// ═══════════════════════════════════════════════
bot.onText(/\/comprar/, async (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'Usuário';

    await bot.sendMessage(chatId, '⏳ Gerando seu Pix...');

    try {
        // 1) Chama o BISTECA Gateway para criar a cobrança
        const response = await fetch(`${GATEWAY_URL}/api/v1/charges`, {
            method: 'POST',
            headers: {
                'Authorization': MERCHANT_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                value: 100, // R$ 1,00 em centavos
                metadata: {
                    chatId: chatId.toString(),
                    userName,
                    product: 'Produto de Teste',
                },
            }),
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        const charge = await response.json();

        // 2) Salva a cobrança pendente para entrega automática
        pendingCharges.set(charge.correlationID, {
            chatId,
            userName,
            product: 'Produto de Teste',
            createdAt: new Date(),
        });

        // 3) Envia o Pix Copia e Cola para o usuário
        await bot.sendMessage(chatId,
            '💰 *Pix gerado com sucesso!*\n\n' +
            `Valor: *R$ 1,00*\n\n` +
            '📋 *Copia e Cola:*\n' +
            '```\n' + charge.brCode + '\n```\n\n' +
            '⏰ _Expira em 1 hora_\n\n' +
            '✅ Após o pagamento, você receberá automaticamente o produto aqui no chat!',
            { parse_mode: 'Markdown' }
        );

        console.log(`[Bot] Pix gerado para ${userName} (chat: ${chatId}) | ${charge.correlationID}`);

    } catch (err) {
        console.error('[Bot] Erro ao gerar Pix:', err.message);
        await bot.sendMessage(chatId, '❌ Erro ao gerar o Pix. Tente novamente em alguns segundos.');
    }
});

// ═══════════════════════════════════════════════
// COMANDO: /status
// ═══════════════════════════════════════════════
bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        '🟢 *Bot BISTECA — Status*\n\n' +
        `Cobranças pendentes: ${pendingCharges.size}\n` +
        `Gateway: ${GATEWAY_URL}\n` +
        `Horário: ${new Date().toLocaleString('pt-BR')}`,
        { parse_mode: 'Markdown' }
    );
});

// ═══════════════════════════════════════════════
// WEBHOOK RECEIVER (Gateway → Bot)
// Escuta na porta 3001 para receber notificações
// de pagamento confirmado do BISTECA Gateway
// ═══════════════════════════════════════════════
const webhookServer = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);

                console.log(`[Bot] Webhook recebido: ${payload.event}`);

                if (payload.event === 'charge.paid') {
                    const { correlationID, value, metadata } = payload.data;
                    const chatId = metadata?.chatId;

                    if (chatId) {
                        // 🎁 ENTREGA O PRODUTO!
                        await bot.sendMessage(parseInt(chatId),
                            '✅ *Pagamento confirmado!*\n\n' +
                            `Valor: R$ ${(value / 100).toFixed(2)}\n\n` +
                            '🎁 *Aqui está seu produto:*\n\n' +
                            '```\n' +
                            '🔑 CHAVE-DO-PRODUTO-12345-ABCDE\n' +
                            '```\n\n' +
                            '_Obrigado pela compra!_ 🚀',
                            { parse_mode: 'Markdown' }
                        );

                        // Remove da lista de pendentes
                        pendingCharges.delete(correlationID);
                        console.log(`[Bot] ✅ Produto entregue para chat ${chatId}`);
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (err) {
                console.error('[Bot] Erro processando webhook:', err.message);
                res.writeHead(500);
                res.end('error');
            }
        });
    } else {
        res.writeHead(404);
        res.end('not found');
    }
});

const WEBHOOK_PORT = 3001;
webhookServer.listen(WEBHOOK_PORT, () => {
    console.log(`📡 Webhook listener rodando em http://localhost:${WEBHOOK_PORT}/webhook`);
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  🤖 Bot BISTECA está no ar!');
    console.log('  Abra seu Telegram e mande /start pro bot');
    console.log('  Depois mande /comprar pra gerar um Pix');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
});
