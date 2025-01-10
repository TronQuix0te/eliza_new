import { Redis } from 'ioredis';

export const createRedisClient = () => {
    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
        },
        maxRetriesPerRequest: 3
    });

    redis.on('error', (error) => {
        console.error('Redis connection error:', error);
    });

    redis.on('connect', () => {
        console.log('Successfully connected to Redis');
    });

    return redis;
};
