const cron = require('node-cron');
const db = require('../database/connection');
const woovi = require('../services/woovi');
const ledger = require('../services/ledger');
const config = require('../config');

/**
 * Job de reconciliação: verifica cobranças pendentes e atualiza com base no status da Woovi.
 * Roda a cada 15 minutos.
 */
function startReconciliationWorker() {
    cron.schedule('*/15 * * * *', async () => {
        console.log('[Reconciliation] Iniciando reconciliação...');

        try {
            // Busca cobranças pendentes há mais de 10 minutos
            const pendingCharges = await db('charges')
                .where('status', 'pending')
                .where('created_at', '<', new Date(Date.now() - 10 * 60 * 1000))
                .limit(50);

            console.log(`[Reconciliation] ${pendingCharges.length} cobranças pendentes para verificar`);

            for (const charge of pendingCharges) {
                try {
                    const wooviResponse = await woovi.getCharge(charge.correlation_id);
                    const wooviStatus = wooviResponse.charge?.status;

                    if (wooviStatus === 'COMPLETED' && charge.status === 'pending') {
                        // Pagamento confirmado que o webhook perdeu!
                        const merchant = await db('merchants').where('id', charge.merchant_id).first();

                        if (merchant) {
                            await ledger.processPayment({
                                chargeId: charge.correlation_id,
                                merchantAccountId: merchant.account_id,
                                amount: charge.value,
                                feeRate: config.platform.feeRate,
                                idempotencyKey: `charge_${charge.correlation_id}`,
                            });

                            await db('charges')
                                .where('id', charge.id)
                                .update({ status: 'paid', paid_at: new Date() });

                            console.log(`[Reconciliation] ✅ Cobrança ${charge.correlation_id} processada via reconciliação`);
                        }
                    }

                    if (wooviStatus === 'EXPIRED' || wooviStatus === 'INACTIVE') {
                        await db('charges')
                            .where('id', charge.id)
                            .update({ status: 'expired' });

                        console.log(`[Reconciliation] Cobrança ${charge.correlation_id} marcada como expirada`);
                    }
                } catch (err) {
                    console.error(`[Reconciliation] Erro ao reconciliar ${charge.correlation_id}:`, err.message);
                }
            }

            console.log('[Reconciliation] Reconciliação concluída');
        } catch (err) {
            console.error('[Reconciliation] Erro geral:', err.message);
        }
    });

    console.log('[Reconciliation] Worker de reconciliação agendado (a cada 15 minutos)');
}

module.exports = { startReconciliationWorker };
