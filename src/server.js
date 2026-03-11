const Fastify = require('fastify');
const path = require('path');
const config = require('./config');
const { apiKeyAuthMiddleware } = require('./middleware/auth');
const { createChargeHandler, getChargeHandler } = require('./routes/charges');
const { wooviWebhookHandler } = require('./routes/webhooks');
const { startPaymentWorker } = require('./workers/payment');
const { startWebhookDispatcher } = require('./workers/webhook-dispatcher');
const { startReconciliationWorker } = require('./workers/reconciliation');
const { startPayoutWorker } = require('./workers/payout');
const { startTelegramBot } = require('./workers/telegram-bot');
const woovi = require('./services/woovi');

async function buildApp() {
    const app = Fastify({
        logger: {
            transport: config.server.env === 'development'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
        },
    });

    // Permite body vazio em requisições JSON (usado pela validação de webhook da Woovi)
    app.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
        try {
            const parsed = body === '' ? {} : JSON.parse(body);
            done(null, parsed);
        } catch (err) {
            err.statusCode = 400;
            done(err, undefined);
        }
    });

    // Plugins
    await app.register(require('@fastify/cors'), { origin: true });
    await app.register(require('@fastify/rate-limit'), { global: false });
    await app.register(require('@fastify/jwt'), { secret: process.env.JWT_SECRET || 'super-secret-bisteca-key-2024' });

    app.decorate('authenticate', async function (request, reply) {
        try {
            await request.jwtVerify();
        } catch (err) {
            reply.status(401).send({ error: 'Token inválido ou expirado' });
        }
    });

    // Serve dashboard static files in production
    const dashboardPath = path.join(__dirname, '..', 'dashboard', 'dist');
    try {
        const fs = require('fs');
        if (fs.existsSync(dashboardPath)) {
            await app.register(require('@fastify/static'), {
                root: dashboardPath,
                prefix: '/',
            });
            // SPA fallback: serve index.html for any non-API/non-webhook route
            app.setNotFoundHandler((req, reply) => {
                if (req.url.startsWith('/api/') || req.url.startsWith('/webhooks/')) {
                    reply.code(404).send({ error: 'Not found' });
                } else {
                    reply.sendFile('index.html');
                }
            });
        }
    } catch (e) { console.log('Dashboard static setup skipped:', e.message); }


    // ========================================
    // Rotas Públicas (sem auth)
    // ========================================

    app.register(require('./routes/auth'), { prefix: '/api/v1/auth' });

    // Health check
    app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

    // Dashboard auto-login config
    app.get('/api/v1/dashboard/config', async () => {
        const key = process.env.DASHBOARD_API_KEY || '';
        return { apiKey: key };
    });

    // Webhook da Woovi (não precisa de auth do merchant, tem validação própria)
    app.all('/webhooks/woovi', wooviWebhookHandler);

    // ========================================
    // Rotas da API (com auth de merchant)
    // ========================================

    app.register(async function apiRoutes(api) {
        // Auth middleware em todas as rotas deste escopo (Apenas API KEY raw para Bots)
        api.addHook('preHandler', apiKeyAuthMiddleware);

        // Cobranças
        api.post('/api/v1/charges', {
            config: {
                rateLimit: {
                    max: 30,
                    timeWindow: '1 minute',
                    keyGenerator: (req) => req.merchantId,
                },
            },
        }, createChargeHandler);

        api.get('/api/v1/charges/:correlationID', getChargeHandler);
    });

    // ========================================
    // Rotas de Admin e Dashboard (JWT Auth)
    // ========================================
    app.register(require('./routes/admin'), { prefix: '/api/v1/admin' });
    app.register(require('./routes/dashboard'), { prefix: '/api/v1/dashboard' });
    app.register(require('./routes/merchant-dashboard'), { prefix: '/api/v1/merchant-dashboard' });
    app.register(require('./routes/payouts'), { prefix: '/api/v1/payouts' });
    app.register(require('./routes/refunds'), { prefix: '/api/v1/refunds' });
    app.register(require('./routes/sandbox'), { prefix: '/api/v1/sandbox' });

    return app;
}

async function start() {
    const app = await buildApp();

    try {
        // Inicia o servidor HTTP
        await app.listen({ port: config.server.port, host: config.server.host });

        console.log(`\n🚀 BISTECA Gateway rodando em http://localhost:${config.server.port}`);
        console.log(`📡 Webhook endpoint: http://localhost:${config.server.port}/webhooks/woovi`);
        console.log(`🔑 API endpoint: http://localhost:${config.server.port}/api/v1/charges\n`);

        // Inicia workers
        startPaymentWorker();
        startWebhookDispatcher();
        startReconciliationWorker();
        startPayoutWorker();
        startTelegramBot();

        // Auto-registra webhook na OpenPix (idempotente — não duplica se já existir)
        if (process.env.BASE_URL && config.woovi.appId) {
            const webhookUrl = `${process.env.BASE_URL}/webhooks/woovi`;
            woovi.createWebhook({
                url: webhookUrl,
                event: 'OPENPIX:CHARGE_COMPLETED',
                name: 'bisteca-charge-completed',
                authorization: config.woovi.webhookSecret || undefined,
            }).then(() => {
                console.log(`📡 Webhook registrado na OpenPix: ${webhookUrl}`);
            }).catch((err) => {
                // Ignora erro se webhook já existe (409) — apenas loga outros erros
                if (err.status !== 409) {
                    console.warn(`⚠️ Falha ao registrar webhook na OpenPix: ${err.message}`);
                    console.warn('Verifique manualmente em https://app.woovi.com → Configurações → Webhooks');
                } else {
                    console.log(`📡 Webhook já registrado na OpenPix: ${webhookUrl}`);
                }
            });

            // Também registra para expiração
            woovi.createWebhook({
                url: webhookUrl,
                event: 'OPENPIX:CHARGE_EXPIRED',
                name: 'bisteca-charge-expired',
                authorization: config.woovi.webhookSecret || undefined,
            }).catch(() => {}); // Silencioso — menos crítico
        } else {
            console.warn('⚠️ BASE_URL ou WOOVI_APP_ID não configurados — webhook não registrado automaticamente');
            console.warn('Configure BASE_URL=https://bisteca-production.up.railway.app no .env');
        }

    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

start();
