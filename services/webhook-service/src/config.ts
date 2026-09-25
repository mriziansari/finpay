import "dotenv/config"

export const config = {
    port: Number(process.env.WEBHOOK_PORT) || 3001,
    host: process.env.HOST || "0.0.0.0",
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    streamKey: "finpay:events:stream",
    consumerGroup: "webhook_delivery_group",
    consumerName: `webhook_worker_${process.pid}`,

}