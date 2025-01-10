import { Redis } from 'ioredis';

// Extend the existing interface
declare module "@elizaos/core" {
    interface IAgentRuntime {
        redisClient?: Redis;
    }
}
