import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { UserRole } from "@prisma/client";
import { authenticate, requireRole, requireMerchantContext } from "../middlewares/auth.middleware.js";
import { getMerchantBalance } from "../services/ledger.service.js";
import { prisma } from "../lib/prisma.js";




export async function ledgerRoutes(app: FastifyInstance, options: FastifyPluginOptions) {

    app.addHook("preHandler", authenticate);
    app.addHook("preHandler",requireRole([UserRole.MERCHANT_ADMIN, UserRole.OPS_ADMIN]));
    app.addHook("preHandler", requireMerchantContext);

    //GET /merchants/me/balance

    app.get("/ledger/balance", async(request: FastifyRequest, reply: FastifyReply) => {
        const {currency = "USD"} = request.query as {currency?: string};
        const balance = await getMerchantBalance(request.merchant!.id, currency.toUpperCase());
        return reply.status(200).send({balance});
    });
    
    // GET /ledger/transactions - List merchant's ledger transactions with entries
    app.get("/ledger/transactions", async (request: FastifyRequest, reply: FastifyReply) => {
        const { limit = 20 } = request.query as { limit?: number };
        const transactions = await prisma.ledgerTransaction.findMany({
            where: {
                merchantId: request.merchant!.id,
            },
            orderBy: { createdAt: "desc" },
            take: Number(limit),
            include: {
                entries: {
                    include: {
                        account: {
                            select: { name: true, type: true, currency: true },
            },
          },
        },
      },
    });
    return reply.status(200).send({ data: transactions });
  });
}
  