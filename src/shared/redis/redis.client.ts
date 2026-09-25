import {Redis} from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        return delay;
    }
});

redisClient.on("connect", () => {
  console.log("[Redis] Connected successfully to Redis.");
});
redisClient.on("error", (err) => {
  console.error("[Redis] Redis connection error:", err.message);
});