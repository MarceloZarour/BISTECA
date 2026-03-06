const Fastify = require('fastify');
const path = require('path');
const config = require('./config');
const { authMiddleware } = require('./middleware/auth');
const { createChargeHandler, getChargeHandler } = require('./routes/charges');
const { wooviWebhookHandler } = require('./routes/webhooks');
const { startPaymentWorker } = require('./workers/payment');
const { startWebhookDispatcher } = require('./workers/webhook-dispatcher');
const { startReconciliationWorker } = require('./workers/reconciliation');
const { startPayoutWorker } = require('./workers/payout');

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

    // Serve dashboard static files in production
    const dashboardPath = path.join(__dirname, '..', 'dashboard', 'dist');
    try {
        const fs = require('fs');
        if (fs.existsSync(dashboardPath)) {
            await app.register(require('@fastify/static'), {
                root: dashboardPath,
                prefix: '/',
                decorateReply: false,
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
    } catch (e) { /* dashboard not built yet, no-op */ }

    app.addHook('onRequest', (req, reply, done) => {
        try { require('fs').appendFileSync('woovi_debug.log', `REQ: [${req.method}] ${req.url} headers: ${JSON.stringify(req.headers)}\n`); } catch (e) { }
        done();
    });
    app.addHook('onResponse', (req, reply, done) => {
        try { require('fs').appendFileSync('woovi_debug.log', `RES: [${req.method}] ${req.url} status: ${reply.statusCode}\n`); } catch (e) { }
        done();
    });

    // ========================================
    // Rotas Públicas (sem auth)
    // ========================================

    // Health check
    app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

    // Webhook da Woovi (não precisa de auth do merchant, tem validação própria)
    app.all('/webhooks/woovi', wooviWebhookHandler);

    // ========================================
    // Rotas da API (com auth de merchant)
    // ========================================

    app.register(async function apiRoutes(api) {
        // Auth middleware em todas as rotas deste escopo
        api.addHook('preHandler', authMiddleware);

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

        // Saques (Payouts)
        api.register(require('./routes/payouts'), { prefix: '/api/v1/payouts' });
    });

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

    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

start();
