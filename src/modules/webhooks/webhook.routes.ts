import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { UserRole } from "@prisma/client";
import { authenticate, requireRole, requireMerchantContext } from "../../shared/middlewares/auth.middleware.js";
import { registerWebhookEndpoint, listWebhookEndpoints } from "./webhook.service.js";
import { prisma } from "../../shared/database/prisma.js";

interface RegisterEndpointBody {
  url: string;
  events?: string[];
}

export async function webhookRoutes(app: FastifyInstance, options: FastifyPluginOptions) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole([UserRole.MERCHANT_ADMIN, UserRole.OPS_ADMIN]));
  app.addHook("preHandler", requireMerchantContext);

  // POST /webhooks/endpoints - Register a new webhook endpoint
  app.post("/webhooks/endpoints", async (request: FastifyRequest<{ Body: RegisterEndpointBody }>, reply: FastifyReply) => {
    const { url, events } = request.body || {};

    if (!url) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Webhook 'url' is required",
      });
    }

    try {
      const endpoint = await registerWebhookEndpoint({
        merchantId: request.merchant!.id,
        url,
        ...(events !== undefined && { events }),
      });

      return reply.status(201).send({
        message: "Webhook endpoint registered successfully",
        endpoint,
      });
    } catch (error: any) {
      const status = error.status || 500;
      return reply.status(status).send({
        error: status === 400 ? "Bad Request" : "Internal Server Error",
        message: error.message || "Failed to register webhook endpoint",
      });
    }
  });

  // GET /webhooks/endpoints - List merchant's webhook endpoints
  app.get("/webhooks/endpoints", async (request: FastifyRequest, reply: FastifyReply) => {
    const endpoints = await listWebhookEndpoints(request.merchant!.id);
    return reply.status(200).send({ data: endpoints });
  });

  // GET /webhooks/deliveries - List delivery audit history for merchant's endpoints
  app.get("/webhooks/deliveries", async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit = 20 } = request.query as { limit?: number };

    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        endpoint: {
          merchantId: request.merchant!.id,
        },
      },
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      include: {
        endpoint: {
          select: { url: true, isActive: true },
        },
      },
    });

    return reply.status(200).send({ data: deliveries });
  });
}
