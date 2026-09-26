import "dotenv/config";

export const config = {
  port: Number(process.env.LEDGER_PORT) || 3002,
  host: process.env.HOST || "0.0.0.0",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  streamKey: "finpay:events:stream",
  consumerGroup: "ledger_accounting_group",
  consumerName: `ledger_worker_${process.pid}`,
};