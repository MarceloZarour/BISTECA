const db = require('../database/connection');

/**
 * Endpoints protegidos para o Dashboard do Lojista (Merchant).
 * Usa Autenticação via JWT Bearer Token.
 */
async function merchantDashboardRoutes(app) {
    // Middleware de autenticação JWT
    app.addHook('preHandler', app.authenticate);
    app.addHook('preHandler', async (request, reply) => {
        const merchant = await db('merchants').where('id', request.user.id).first();
        if (!merchant) return reply.status(404).send({ error: 'Lojista não encontrado' });

        request.merchantId = merchant.id;
        request.merchantAccountId = merchant.account_id;
        request.merchant = merchant;
    });

    // ==========================================
    // GET /stats - KPIs e Gráficos da Visão Geral (Apenas do Merchant)
    // ==========================================
    app.get('/stats', async (request, reply) => {
        const merchantId = request.merchantId;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Função auxiliar: Para o lojista, 'value' em charges é o valor BRUTO.
        // O lojista ganha o valor líquido. O valor líquido é calculado deduzindo a taxa.
        // Mas a forma mais exata de pegar o volume de vendas para o Lojista é buscar no Ledger
        // todas as entradas de 'credit' na conta dele referentes a vendas (ou usar charges e aplicar a taxa).
        // Vamos usar charges para simplificar, mas deduzindo a taxa para dar o valor LÍQUIDO em "Vendas".
        const feeRate = parseFloat(request.merchant.fee_rate || 0.05);

        const getStats = async (startDate, endDate) => {
            let query = db('charges')
                .where('merchant_id', merchantId)
                .where('status', 'paid')
                .where('paid_at', '>=', startDate);

            if (endDate) {
                query = query.where('paid_at', '<', endDate);
            }

            const result = await query.sum('value as total').count('id as count').first();
            const gross = parseInt(result.total || 0, 10);
            const count = parseInt(result.count || 0, 10);

            // Valor líquido (o que sobrou pro lojista)
            const fee = Math.round(gross * feeRate);
            const net = gross - fee;

            return {
                total: net, // KPIs mostram o líquido para o lojista
                count: count,
                ticket: count > 0 ? Math.round(net / count) : 0
            };
        };

        const currentMonth = await getStats(startOfMonth);
        const lastMonth = await getStats(startOfLastMonth, startOfMonth);
        const today = await getStats(startOfToday);

        const calcDelta = (current, last) => {
            if (last === 0) return current > 0 ? 100 : 0;
            return ((current - last) / last) * 100;
        };

        const deltas = {
            vendas: calcDelta(currentMonth.total, lastMonth.total),
            ticket: calcDelta(currentMonth.ticket, lastMonth.ticket),
            pixPagos: calcDelta(currentMonth.count, lastMonth.count),
            vendasHoje: calcDelta(today.total, lastMonth.total / 30) // simplificado
        };

        // Gráfico da Semana
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(now.getDate() - 7);

        const weekDataRaw = await db('charges')
            .where('merchant_id', merchantId)
            .where('status', 'paid')
            .where('paid_at', '>=', sevenDaysAgo)
            .select(db.raw('EXTRACT(ISODOW FROM paid_at) as dow'))
            .sum('value as total')
            .count('id as count')
            .groupBy('dow');

        const weekSales = Array(7).fill(0);
        const weekTicket = Array(7).fill(0);

        weekDataRaw.forEach(row => {
            const idx = parseInt(row.dow) - 1;
            if (idx >= 0 && idx < 7) {
                const gross = parseInt(row.total || 0, 10);
                const fee = Math.round(gross * feeRate);
                const net = gross - fee;

                weekSales[idx] = net;
                weekTicket[idx] = Math.round(net / parseInt(row.count || 1, 10));
            }
        });

        return {
            merchantInfo: {
                id: request.merchantId,
                name: request.merchant.name,
                email: request.merchant.email,
                feeRate: request.merchant.fee_rate
            },
            kpis: {
                vendas: currentMonth.total,
                ticket: currentMonth.ticket,
                pixPagos: currentMonth.count,
                vendasHoje: today.total,
                deltas
            },
            charts: {
                weekSales,
                weekTicket
            }
        };
    });

    // ==========================================
    // GET /transactions - Histórico Financeiro do Lojista
    // ==========================================
    app.get('/transactions', async (request, reply) => {
        const merchantId = request.merchantId;

        const charges = await db('charges')
            .where('merchant_id', merchantId)
            .select('id as correlation_id', 'value as amount', 'status', 'created_at', db.raw("'charge' as type"))
            .orderBy('created_at', 'desc')
            .limit(50);

        // Para as transações, podemos subtrair a taxa do amount visualmente, 
        // ou deixar o bruto. Geralmente se mostra o NET na listagem se for a tela dele.
        const feeRate = parseFloat(request.merchant.fee_rate || 0.05);
        const mappedCharges = charges.map(c => {
            if (c.status === 'paid') {
                const fee = Math.round(parseInt(c.amount) * feeRate);
                c.amount = parseInt(c.amount) - fee; // Mostra o líquido
            }
            return c;
        });

        const payouts = await db('payouts')
            .where('merchant_id', merchantId)
            .select('id as correlation_id', 'amount', 'status', 'created_at', db.raw("'payout' as type"))
            .orderBy('created_at', 'desc')
            .limit(50);

        const allTransactions = [...mappedCharges, ...payouts]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 50);

        return { transactions: allTransactions };
    });

    // ==========================================
    // GET /payouts - Histórico de Saques e Saldo (Lojista)
    // ==========================================
    app.get('/payouts', async (request, reply) => {
        const merchantId = request.merchantId;
        const accountId = request.merchantAccountId;

        const balanceRow = await db('account_balances').where('account_id', accountId).first();
        const availableBalance = balanceRow ? parseInt(balanceRow.balance, 10) : 0;

        const payouts = await db('payouts')
            .where('merchant_id', merchantId)
            .orderBy('created_at', 'desc')
            .limit(50);

        return {
            availableBalance,
            payouts
        };
    });
}

module.exports = merchantDashboardRoutes;
