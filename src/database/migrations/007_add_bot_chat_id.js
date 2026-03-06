exports.up = async (knex) => {
    await knex.schema.table('charges', (t) => {
        t.text('bot_chat_id').nullable(); // Telegram chat ID para cobranças geradas pelo bot
    });
};

exports.down = async (knex) => {
    await knex.schema.table('charges', (t) => {
        t.dropColumn('bot_chat_id');
    });
};
