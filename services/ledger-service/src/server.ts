import Fastify from "fastify";
import { config } from "./config.js";
import { ledgerRoutes } from "./ledger.routes.js";
import { startLedgerWorker, stopLedgerWorker } from "./ledger.worker.js";

const app = Fastify({ logger: true });

app.register(ledgerRoutes);

app.get("/health", async () => {
  return { status: "OK", service: "ledger-service", port: config.port };
});

const start = async () => {
  try {
    startLedgerWorker();

    await app.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`[LedgerService] Running on http://${config.host}:${config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

const closeGracefully = async (signal: string) => {
  console.log(`[LedgerService] Received ${signal}, shutting down...`);
  stopLedgerWorker();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => closeGracefully("SIGINT"));
process.on("SIGTERM", () => closeGracefully("SIGTERM"));

start();
