const db = require('../database/connection');

/**
 * Endpoints protegidos para o Dashboard do Administrador.
 * Usa DASHBOARD_API_KEY para autenticação.
 */
async function dashboardRoutes(app) {
    // Middleware de autenticação Admin via JWT
    app.addHook('preHandler', app.authenticate);
    app.addHook('preHandler', async (request, reply) => {
        if (request.user.role !== 'admin') {
            return reply.status(403).send({ error: 'Acesso negado: Requer privilégios de administrador' });
        }
    });

    // ==========================================
    // GET /stats - KPIs e Gráficos da Visão Geral
    // ==========================================
    app.get('/stats', async (request, reply) => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Função auxiliar para buscar somatórios de charges 'paid'
        const getStats = async (startDate, endDate) => {
            let query = db('charges')
                .where('status', 'paid')
                .where('paid_at', '>=', startDate);

            if (endDate) {
                query = query.where('paid_at', '<', endDate);
            }

            const result = await query.sum('value as total').count('id as count').first();
            return {
                total: parseInt(result.total || 0, 10),
                count: parseInt(result.count || 0, 10),
                ticket: parseInt(result.count || 0, 10) > 0 ? Math.round((result.total || 0) / result.count) : 0
            };
        };

        const currentMonth = await getStats(startOfMonth);
        const lastMonth = await getStats(startOfLastMonth, startOfMonth);
        const today = await getStats(startOfToday);

        // Calcula deltas (porcentagem de crescimento/queda)
        const calcDelta = (current, last) => {
            if (last === 0) return current > 0 ? 100 : 0;
            return ((current - last) / last) * 100;
        };

        const deltas = {
            vendas: calcDelta(currentMonth.total, lastMonth.total),
            ticket: calcDelta(currentMonth.ticket, lastMonth.ticket),
            pixPagos: calcDelta(currentMonth.count, lastMonth.count),
            // Para "vendas hoje" vs "média diária do mês passado", simplificando:
            vendasHoje: calcDelta(today.total, lastMonth.total / 30)
        };

        // Dados para os gráficos de "Dia da Semana" (últimos 7 dias agrupados por dia da semana ISO 1-7)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(now.getDate() - 7);

        const weekDataRaw = await db('charges')
            .where('status', 'paid')
            .where('paid_at', '>=', sevenDaysAgo)
            .select(db.raw('EXTRACT(ISODOW FROM paid_at) as dow'))
            .sum('value as total')
            .count('id as count')
            .groupBy('dow');

        // Inicializa array de 7 posições (1=Seg, 7=Dom)
        const weekSales = Array(7).fill(0);
        const weekTicket = Array(7).fill(0);

        weekDataRaw.forEach(row => {
            // Dow: 1=Monday, 7=Sunday. Array index: 0=Monday, 6=Sunday
            const idx = parseInt(row.dow) - 1;
            if (idx >= 0 && idx < 7) {
                weekSales[idx] = parseInt(row.total || 0, 10);
                weekTicket[idx] = Math.round(weekSales[idx] / parseInt(row.count || 1, 10));
            }
        });

        return {
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
    // GET /transactions - Histórico Financeiro
    // ==========================================
    app.get('/transactions', async (request, reply) => {
        // Busca os últimos 50 charges
        const charges = await db('charges')
            .select('id as correlation_id', 'value as amount', 'status', 'created_at', db.raw("'charge' as type"))
            .orderBy('created_at', 'desc')
            .limit(50);

        // Busca os últimos 50 payouts
        const payouts = await db('payouts')
            .select('id as correlation_id', 'amount', 'status', 'created_at', db.raw("'payout' as type"))
            .orderBy('created_at', 'desc')
            .limit(50);

        // Junta e ordena
        const allTransactions = [...charges, ...payouts]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 50);

        return { transactions: allTransactions };
    });

    // ==========================================
    // GET /payouts - Histórico de Saques e Saldo Total (Admin)
    // ==========================================
    app.get('/payouts', async (request, reply) => {
        // Para o admin, o "saldo disponível" é o saldo da conta PLATFORM + Escrows menos pendências
        const balances = await db('account_balances').select('account_id', 'balance');
        const accounts = await db('accounts').select('id', 'owner_type');

        let totalBalance = 0;
        const platformAccounts = accounts.filter(a => ['platform', 'escrow', 'payout_escrow'].includes(a.owner_type)).map(a => a.id);

        balances.forEach(b => {
            if (platformAccounts.includes(b.account_id)) {
                totalBalance += parseInt(b.balance, 10);
            }
        });

        const payouts = await db('payouts').orderBy('created_at', 'desc').limit(50);

        return {
            availableBalance: totalBalance,
            payouts
        };
    });
}

module.exports = dashboardRoutes;
