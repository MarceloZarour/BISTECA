const Redis = require('ioredis');
const config = require('./config');

const redisUrl = config.redis.url;
console.log(`[Redis] Connecting to: ${redisUrl ? redisUrl.replace(/:[^:@]+@/, ':***@') : 'DEFAULT localhost'}`);

const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    family: 0,  // Dual-stack: try both IPv4 and IPv6
    retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        console.log(`[Redis] Retry #${times}, next in ${delay}ms`);
        return delay;
    },
});

redis.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
    console.log('[Redis] Connected successfully');
});

module.exports = redis;
