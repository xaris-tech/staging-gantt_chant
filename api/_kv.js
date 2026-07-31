const { Redis } = require('@upstash/redis');

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function client() {
  const config = redisConfig();
  if (!config) return null;
  if (!globalThis.__STAGEFLOW_REDIS_CLIENT__) {
    globalThis.__STAGEFLOW_REDIS_CLIENT__ = new Redis({ url: config.url, token: config.token });
  }
  return globalThis.__STAGEFLOW_REDIS_CLIENT__;
}

module.exports = { client, redisConfig };
