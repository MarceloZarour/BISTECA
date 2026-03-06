/**
 * Script para configurar o banco de dados PostgreSQL.
 * Tenta conectar com a senha padrão do Windows installer,
 * cria o user 'bisteca' e o database 'bisteca'.
 */
const { Client } = require('pg');

const PASSWORDS_TO_TRY = ['postgres', 'admin', 'password', '123456', '1234', ''];

async function setup() {
    let client;
    let connectedPassword = null;

    // Tenta conectar com senhas comuns
    for (const pwd of PASSWORDS_TO_TRY) {
        try {
            client = new Client({
                host: 'localhost',
                port: 5432,
                user: 'postgres',
                password: pwd,
                database: 'postgres',
            });
            await client.connect();
            connectedPassword = pwd;
            console.log(`✅ Conectado ao PostgreSQL com senha: "${pwd || '(vazia)'}"`);
            break;
        } catch (err) {
            if (client) await client.end().catch(() => { });
            client = null;
        }
    }

    if (!client) {
        console.error('❌ Não consegui conectar ao PostgreSQL com nenhuma senha padrão.');
        console.error('   Por favor, me informe a senha que você definiu quando instalou o PostgreSQL.');
        process.exit(1);
    }

    try {
        // Criar user 'bisteca'
        try {
            await client.query(`CREATE USER bisteca WITH PASSWORD 'bisteca_dev_2024'`);
            console.log('✅ Usuário "bisteca" criado');
        } catch (err) {
            if (err.code === '42710') {
                console.log('ℹ️  Usuário "bisteca" já existe');
            } else {
                throw err;
            }
        }

        // Criar database 'bisteca'
        try {
            await client.query(`CREATE DATABASE bisteca OWNER bisteca`);
            console.log('✅ Database "bisteca" criado');
        } catch (err) {
            if (err.code === '42P04') {
                console.log('ℹ️  Database "bisteca" já existe');
            } else {
                throw err;
            }
        }

        // Dar permissões
        await client.query(`GRANT ALL PRIVILEGES ON DATABASE bisteca TO bisteca`);
        console.log('✅ Permissões concedidas');

        console.log('\n🎉 PostgreSQL configurado com sucesso!');
        console.log('   Connection string: postgres://bisteca:bisteca_dev_2024@localhost:5432/bisteca');
    } finally {
        await client.end();
    }
}

setup().catch(console.error);
