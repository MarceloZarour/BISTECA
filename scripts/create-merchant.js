/**
 * Script: Cria o primeiro merchant de teste e gera sua API key.
 * Roda uma vez: node scripts/create-merchant.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const crypto = require('crypto');
const db = require('../src/database/connection');

async function createTestMerchant() {
    try {
        // 1) Gera a API key
        const apiKey = `bst_live_${crypto.randomBytes(32).toString('hex')}`;
        const apiKeyHash = await bcrypt.hash(apiKey, 10);
        const apiKeyPrefix = apiKey.substring(0, 20);

        // 2) Cria a conta contábil do merchant
        const [account] = await db('accounts').insert({
            owner_type: 'merchant',
        }).returning('*');

        // 3) Cria o merchant
        const [merchant] = await db('merchants').insert({
            name: 'Bot de Teste',
            email: 'teste@bisteca.dev',
            api_key_hash: apiKeyHash,
            api_key_prefix: apiKeyPrefix,
            account_id: account.id,
            webhook_url: 'http://localhost:3001/webhook', // O bot vai escutar aqui
            is_active: true,
        }).returning('*');

        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('  🎉 MERCHANT CRIADO COM SUCESSO!');
        console.log('═══════════════════════════════════════════════════');
        console.log('');
        console.log('  Nome:       Bot de Teste');
        console.log(`  Merchant ID: ${merchant.id}`);
        console.log(`  Account ID:  ${account.id}`);
        console.log('');
        console.log('  ⚠️  SUA API KEY (GUARDE, SÓ APARECE UMA VEZ):');
        console.log('');
        console.log(`  ${apiKey}`);
        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('');

    } catch (err) {
        if (err.code === '23505') {
            console.log('ℹ️  Merchant já existe. Se quiser recriar, rode: npm run db:rollback && npm run db:migrate');
        } else {
            console.error('❌ Erro:', err.message);
        }
    } finally {
        await db.destroy();
    }
}

createTestMerchant();
