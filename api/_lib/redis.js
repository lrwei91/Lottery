import { Redis } from '@upstash/redis';

let redisClient;

export function getRedis(options = {}) {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (options.required === false) return null;
    throw new Error('Missing required Upstash Redis environment variables');
  }
  redisClient = new Redis({ url, token });
  return redisClient;
}
