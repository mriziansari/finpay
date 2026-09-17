import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { UserRole } from "@prisma/client";
import { authenticate, requireRole, requireMerchantContext } from "../middlewares/auth.middleware.js";
import { createPayout } from "../services/payout.service.js";
import { prisma } from "../lib/prisma.js";

interface CreatePayoutBody {
  amount: number;
  currency: string;
}

export async function payoutRoutes(app: FastifyInstance, options: FastifyPluginOptions) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole([UserRole.MERCHANT_ADMIN, UserRole.OPS_ADMIN]));
  app.addHook("preHandler", requireMerchantContext);

  // POST /payouts - Request a withdrawal
  app.post("/payouts", async (request: FastifyRequest<{ Body: CreatePayoutBody }>, reply: FastifyReply) => {
    const { amount, currency } = request.body || {};
    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

    if (!idempotencyKey || !idempotencyKey.trim()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Idempotency-key header is required",
      });
    }

    if (!amount || !currency) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Amount and Currency are required",
      });
    }

    try {
      const result = await createPayout({
        merchantId: request.merchant!.id,
        amount,
        currency,
        idempotencyKey: idempotencyKey.trim(),
      });

      if (result.isIdempotentReply) {
        reply.header("Idempotent-Replayed", "true");
        return reply.status(200).send({
          payout: result.payout,
          message: "Payout retrieved (idempotent replay)",
        });
      }

      return reply.status(201).send({
        message: "Payout processed successfully",
        payout: result.payout,
      });
    } catch (error: any) {
      const status = error.status || 500;
      return reply.status(status).send({
        error: status === 400 ? "Bad Request" : "Internal Server Error",
        message: error.message || "Failed to process payout",
      });
    }
  });

  // GET /payouts - List merchant payouts
  app.get("/payouts", async (request: FastifyRequest, reply: FastifyReply) => {
    const payouts = await prisma.payout.findMany({
      where: { merchantId: request.merchant!.id },
      orderBy: { createdAt: "desc" },
    });
    return reply.status(200).send({ data: payouts });
  });
}
