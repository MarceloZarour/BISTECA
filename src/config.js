require('dotenv').config();

module.exports = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
  },

  database: {
    url: process.env.DATABASE_URL || 'postgres://bisteca:bisteca_dev_2024@localhost:5432/bisteca',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  woovi: {
    apiUrl: process.env.WOOVI_API_URL || 'https://api.woovi.com',
    appId: process.env.WOOVI_APP_ID || '',
    webhookSecret: process.env.WOOVI_WEBHOOK_SECRET || '',
  },

  platform: {
    feeRate: parseFloat(process.env.PLATFORM_FEE_RATE || '0.05'),
    minPayoutAmount: parseInt(process.env.MIN_PAYOUT_AMOUNT || '1000', 10),
  },

  webhookDispatch: {
    timeoutMs: parseInt(process.env.WEBHOOK_DISPATCH_TIMEOUT_MS || '5000', 10),
  },
};
