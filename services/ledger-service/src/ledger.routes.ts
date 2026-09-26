import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { getMerchantBalance } from "./ledger.engine.js";

export async function ledgerRoutes(app: FastifyInstance, options: FastifyPluginOptions) {
  // GET /internal/merchants/:merchantId/balance
  app.get("/internal/merchants/:merchantId/balance", async (request: FastifyRequest, reply: FastifyReply) => {
    const { merchantId } = request.params as { merchantId: string };
    const { currency = "USD" } = request.query as { currency?: string };

    const balance = await getMerchantBalance(merchantId, currency);
    return reply.status(200).send({ data: balance });
  });
}
