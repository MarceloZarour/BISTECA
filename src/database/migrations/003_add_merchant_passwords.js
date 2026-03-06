exports.up = async function (knex) {
    await knex.schema.alterTable('merchants', (t) => {
        t.string('password_hash');
        t.string('role').defaultTo('merchant'); // admin or merchant
    });

    // We can also create a default admin user via migration or just let them register and manually set it to admin via sql.
    // Let's create an initial admin if not exists:
    const adminEmail = 'admin@bisteca.com';
    const existingAdmin = await knex('merchants').where({ email: adminEmail }).first();

    if (!existingAdmin) {
        const bcrypt = require('bcryptjs');
        const hash = await bcrypt.hash('admin123', 10);
        const crypto = require('crypto');

        const rawApiKey = `bst_live_${crypto.randomBytes(32).toString('hex')}`;
        const apiKeyHash = await bcrypt.hash(rawApiKey, 10);
        const apiKeyPrefix = rawApiKey.substring(0, 16);

        const [merchant] = await knex('merchants').insert({
            name: 'Administrador Bisteca',
            email: adminEmail,
            password_hash: hash,
            role: 'admin',
            api_key_hash: apiKeyHash,
            api_key_prefix: apiKeyPrefix,
            fee_rate: 0
        }).returning('*');

        const [account] = await knex('accounts').insert({
            owner_type: 'merchant',
            owner_id: merchant.id
        }).returning('*');

        await knex('merchants')
            .where('id', merchant.id)
            .update({ account_id: account.id });
    }
};

exports.down = async function (knex) {
    await knex.schema.alterTable('merchants', (t) => {
        t.dropColumn('password_hash');
        t.dropColumn('role');
    });
};
