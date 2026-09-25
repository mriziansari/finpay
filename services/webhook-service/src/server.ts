import Fastify from "fastify";
import { config } from "./config.js";
import { startWebhookWorker, stopWebhookWorker } from "./webhook.worker.js";

const app = Fastify({ logger: true });

// Health check endpoint
app.get("/health", async () => {
  return { status: "OK", service: "webhook-service", port: config.port };
});

const start = async () => {
  try {
    // 1. Start the Redis Stream consumer worker
    startWebhookWorker();

    // 2. Start HTTP server
    await app.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`[WebhookService] Running on http://${config.host}:${config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

const closeGracefully = async (signal: string) => {
  console.log(`[WebhookService] Received ${signal}, shutting down...`);
  stopWebhookWorker();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => closeGracefully("SIGINT"));
process.on("SIGTERM", () => closeGracefully("SIGTERM"));

start();
