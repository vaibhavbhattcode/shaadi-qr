import Redis from 'ioredis';

let redisClient = null;
let isRedisConnected = false;

const memoryFallback = {
  _store: {},
  _lists: {},
  async get(key) { return this._store[key] || null; },
  async set(key, val) { this._store[key] = String(val); return 'OK'; },
  async del(key) { delete this._store[key]; return 1; },
  async rpush(key, ...values) {
    if (!this._lists[key]) this._lists[key] = [];
    this._lists[key].push(...values.map(String));
    return this._lists[key].length;
  },
  async lpop(key) {
    return this._lists[key]?.shift() || null;
  },
  on() {}
};

const redisUrl = process.env.REDIS_URL;

if (redisUrl) {
  console.log('[REDIS] Connecting to Redis using REDIS_URL...');
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    connectTimeout: 3000,
    retryStrategy(times) {
      if (times > 2) {
        console.warn('[REDIS] Max retries reached. Falling back to memory store.');
        return null; // Stop retrying
      }
      return Math.min(times * 100, 1000);
    }
  });

  redisClient.on('error', (err) => {
    console.warn('[REDIS ERROR] Connection failed, using in-memory store fallback:', err.message);
    // Dynamically redirect client operations to memory fallback
    Object.assign(redisClient, memoryFallback);
    isRedisConnected = false;
  });

  redisClient.on('connect', () => {
    isRedisConnected = true;
    console.log('[REDIS] Successfully connected.');
  });
} else {
  console.log('[REDIS] No REDIS_URL configured. Using in-memory fallback queue handler.');
  redisClient = memoryFallback;
}

export { redisClient, isRedisConnected };
