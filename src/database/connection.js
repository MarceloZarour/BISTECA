const knex = require('knex');
const config = require('../config');

const db = knex({
    client: 'pg',
    connection: config.database.url,
    pool: { min: 2, max: 10 },
    migrations: {
        directory: './src/database/migrations',
    },
});

module.exports = db;
