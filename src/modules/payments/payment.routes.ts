import { createPayment } from "./payment.service.js";
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { UserRole } from "@prisma/client";
import { requireRole, authenticate, requireMerchantContext } from "../../shared/middlewares/auth.middleware.js";
import { prisma } from "../../shared/database/prisma.js";
import { createRefund } from "../refund/index.js";


// Request Body 
interface CreatePaymentBody {
    customerId: string;
    amount: number;
    currency: string;
}

interface CreatePaymentHeader {
    "idempotency-key": string;
    "x-mock-processor-scenario"?: string;
}

export async function paymentRoutes(app: FastifyInstance, options: FastifyPluginOptions) {

    app.addHook("preHandler", authenticate);
    app.addHook("preHandler", requireRole([UserRole.MERCHANT_ADMIN, UserRole.OPS_ADMIN]));
    app.addHook("preHandler", requireMerchantContext);

    // POST /payments
    app.post("/payments", async (request: FastifyRequest<{ Body: CreatePaymentBody; Headers: CreatePaymentHeader }>, reply: FastifyReply) => {
        const { customerId, amount, currency } = request.body || {};
        const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
        const mockScenarioHeader = request.headers["x-mock-processor-scenario"] as string | undefined;

        if (!idempotencyKey || !idempotencyKey.trim()) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Idempotency-key is required"
            });
        }

        if (!customerId || amount === undefined || !currency) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Customer ID, Amount, and Currency are required"
            });
        }

        try {
            const result = await createPayment({
                merchantId: request.merchant!.id,
                customerId: customerId,
                amount: amount,
                currency: currency.trim().toUpperCase(),
                idempotencyKey: idempotencyKey.trim(),
                mockProcessorScenario: mockScenarioHeader?.toUpperCase() as any
            });

            if (result.isIdempotentReply) {
                reply.header("Idempotent-Replayed", "true");
                return reply.status(200).send({
                    payment: result.payment,
                    message: "Payment retrieved (idempotent replay)",
                });
            }

            // Fresh payment created
            return reply.status(201).send({
                message: "Payment created successfully",
                payment: result.payment
            });

        } catch (error: any) {
            const status = error.status || 500;
            let errorTitle = "Internal Server Error";
            if (status === 400) errorTitle = "Bad Request";
            if (status === 404) errorTitle = "Not Found";
            if (status === 409) errorTitle = "Conflict";

            return reply.status(status).send({
                error: errorTitle,
                message: error.message || "Failed to process payment"
            });
        }
    });

    // GET /payments/:id - fetch a single payment + its attempts
    app.get("/payments/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const paymentId = request.params.id;

        const payment = await prisma.payment.findFirst({
            where: {
                id: paymentId,
                merchantId: request.merchant!.id
            },
            include: {
                attempts: {
                    orderBy: { attemptNumber: "asc" },
                },
                customer: true,
                refunds: true,
            },
        });

        if (!payment) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Payment Not Found"
            });
        }

        return reply.status(200).send({ payment });
    });

    // GET /payments - list payments with optional filters (status, date, customer)
    app.get("/payments", async (request: FastifyRequest, reply: FastifyReply) => {
        const {
            status,
            customerId,
            from,
            to,
            cursor,
            limit = 20,
        } = request.query as any;

        const where: any = { merchantId: request.merchant!.id };
        if (status) where.status = status;
        if (customerId) where.customerId = customerId;
        if (from || to) {
            where.createdAt = {};
            if (from) where.createdAt.gte = new Date(from);
            if (to) where.createdAt.lte = new Date(to);
        }
        if (cursor) where.id = { gt: cursor };

        const payments = await prisma.payment.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: Number(limit) + 1,
            include: { attempts: true },
        });

        const hasNextPage = payments.length > limit;
        const results = hasNextPage ? payments.slice(0, limit) : payments;
        // Optional chaining handles `noUncheckedIndexedAccess` safely
        const lastItem = results[results.length - 1];
        const nextCursor = hasNextPage && lastItem ? lastItem.id : null;

        return reply.status(200).send({
            data: results,
            pagination: {
                nextCursor,
                hasNextPage,
            },
        });
    });

        // POST /payments/:id/refunds - Issue full or partial refund
    app.post(
      "/payments/:id/refunds",
      async (
        request: FastifyRequest<{
          Params: { id: string };
          Body: { amount?: number; reason?: string };
        }>,
        reply: FastifyReply
      ) => {
        const paymentId = request.params.id;
        const { amount, reason } = request.body || {};
        const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

        if (!idempotencyKey || !idempotencyKey.trim()) {
          return reply.status(400).send({
            error: "Bad Request",
            message: "Idempotency-key header is required",
          });
        }

        try {
          const result = await createRefund({
            paymentId,
            merchantId: request.merchant!.id,
            idempotencyKey: idempotencyKey.trim(),
            ...(amount !== undefined && { amount }),
            ...(reason !== undefined && { reason }),
          });

          if (result.isIdempotentReply) {
            reply.header("Idempotent-Replayed", "true");
            return reply.status(200).send({
              refund: result.refund,
              message: "Refund retrieved (idempotent replay)",
            });
          }

          return reply.status(201).send({
            message: "Refund processed successfully",
            refund: result.refund,
          });
        } catch (error: any) {
          const status = error.status || 500;
          return reply.status(status).send({
            error: status === 400 ? "Bad Request" : status === 404 ? "Not Found" : "Internal Server Error",
            message: error.message || "Failed to process refund",
          });
        }
      }
    );

    // GET /payments/:id/refunds - List all refunds for a payment
    app.get(
      "/payments/:id/refunds",
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const paymentId = request.params.id;

        const payment = await prisma.payment.findFirst({
          where: {
            id: paymentId,
            merchantId: request.merchant!.id,
          },
        });

        if (!payment) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Payment Not Found",
          });
        }

        const refunds = await prisma.refund.findMany({
          where: {
            paymentId,
            merchantId: request.merchant!.id,
          },
          orderBy: { createdAt: "desc" },
        });

        return reply.status(200).send({ data: refunds });
      }
    );

}