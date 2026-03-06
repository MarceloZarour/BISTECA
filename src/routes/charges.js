const { v4: uuid } = require('uuid');
const woovi = require('../services/woovi');
const db = require('../database/connection');

/**
 * Rota: POST /api/v1/charges
 * Cria uma cobrança Pix via Woovi e retorna o Copia e Cola.
 */
async function createChargeHandler(request, reply) {
    const { value, expiresIn, splits, customer, metadata } = request.body;
    const merchantId = request.merchantId; // vem do middleware de auth

    if (!value || value < 100) {
        return reply.status(400).send({ error: 'Valor mínimo é R$ 1,00 (100 centavos)' });
    }

    const correlationID = uuid();

    try {
        // 1) Cria a cobrança na Woovi
        const wooviResponse = await woovi.createCharge({
            value,
            correlationID,
            expiresIn: expiresIn || 3600, // 1h padrão
            splits,
            customer,
        });

        // 2) Salva no nosso banco
        await db('charges').insert({
            correlation_id: correlationID,
            merchant_id: merchantId,
            value,
            status: 'pending',
            br_code: wooviResponse.brCode,
            qr_code_image: wooviResponse.charge?.qrCodeImage || null,
            payment_link_url: wooviResponse.charge?.paymentLinkUrl || null,
            woovi_global_id: wooviResponse.charge?.globalID || null,
            expires_at: wooviResponse.charge?.expiresDate || null,
            metadata: metadata ? JSON.stringify(metadata) : null,
        });

        // 3) Retorna o essencial pro Bot (resposta ultra-rápida)
        return reply.status(201).send({
            correlationID,
            brCode: wooviResponse.brCode,                    // Pix Copia e Cola
            qrCodeImage: wooviResponse.charge?.qrCodeImage,  // URL da imagem QR
            paymentLinkUrl: wooviResponse.charge?.paymentLinkUrl,
            value,
            expiresAt: wooviResponse.charge?.expiresDate,
        });
    } catch (err) {
        request.log.error(err, 'Erro ao criar cobrança na Woovi');
        return reply.status(502).send({ error: 'Falha ao gerar cobrança Pix' });
    }
}

/**
 * Rota: GET /api/v1/charges/:correlationID
 * Busca status de uma cobrança.
 */
async function getChargeHandler(request, reply) {
    const { correlationID } = request.params;
    const merchantId = request.merchantId;

    const charge = await db('charges')
        .where({ correlation_id: correlationID, merchant_id: merchantId })
        .first();

    if (!charge) {
        return reply.status(404).send({ error: 'Cobrança não encontrada' });
    }

    return reply.send({
        correlationID: charge.correlation_id,
        value: charge.value,
        status: charge.status,
        brCode: charge.br_code,
        qrCodeImage: charge.qr_code_image,
        paidAt: charge.paid_at,
        createdAt: charge.created_at,
    });
}

module.exports = { createChargeHandler, getChargeHandler };
