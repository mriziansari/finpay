import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient, UserRole } from "@prisma/client";
import { generateWebhookSecret } from "./crypto.js";

const prisma = new PrismaClient();

interface RegisterEndpointBody {
  url: string;
  events?: string[];
}

export async function webhookRoutes(app: FastifyInstance, options: FastifyPluginOptions) {
  // Pre-handler hook to authenticate JWT and enforce merchant role
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: "Unauthorized", message: "Invalid or missing token" });
    }

    const user = request.user as { userId: string; role: string; merchantId?: string };
    if (!user || (user.role !== UserRole.MERCHANT_ADMIN && user.role !== UserRole.OPS_ADMIN)) {
      return reply.status(403).send({ error: "Forbidden", message: "Insufficient permissions" });
    }

    if (!user.merchantId) {
      return reply.status(400).send({ error: "Bad Request", message: "Merchant context required" });
    }
  });

  // POST /api/v1/webhooks/endpoints - Register new endpoint
  app.post("/api/v1/webhooks/endpoints", async (request: FastifyRequest<{ Body: RegisterEndpointBody }>, reply: FastifyReply) => {
    const { url, events = ["*"] } = request.body || {};
    const user = request.user as { merchantId: string };

    if (!url) {
      return reply.status(400).send({ error: "Bad Request", message: "Webhook 'url' is required" });
    }

    try {
      new URL(url); // Basic URL validation
    } catch {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid webhook URL format" });
    }

    const secret = generateWebhookSecret();
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        merchantId: user.merchantId,
        url,
        secret,
        events,
        isActive: true,
      },
    });

    return reply.status(201).send({
      message: "Webhook endpoint registered successfully",
      endpoint,
    });
  });

  // GET /api/v1/webhooks/endpoints - List merchant's endpoints
  app.get("/api/v1/webhooks/endpoints", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { merchantId: string };
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { merchantId: user.merchantId },
      orderBy: { createdAt: "desc" },
    });
    return reply.status(200).send({ data: endpoints });
  });

  // GET /api/v1/webhooks/deliveries - List delivery logs
  app.get("/api/v1/webhooks/deliveries", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { merchantId: string };
    const { limit = 20 } = request.query as { limit?: number };

    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        endpoint: {
          merchantId: user.merchantId,
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
