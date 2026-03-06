const path = require('path');
require('dotenv').config();

module.exports = {
    client: 'pg',
    connection: process.env.DATABASE_URL || 'postgres://bisteca:bisteca_dev_2024@localhost:5432/bisteca',
    migrations: {
        directory: path.join(__dirname, 'src', 'database', 'migrations'),
    },
};
