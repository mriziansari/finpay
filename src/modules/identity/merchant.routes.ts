import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { authenticate, requireMerchantContext, requireRole } from "../../shared/middlewares/auth.middleware.js";
import { UserRole } from "@prisma/client";
import { prisma } from "../../shared/database/prisma.js";

// Routes for Merchant Management (Admin Portal)
export async function merchantRoutes(app: FastifyInstance, options: FastifyPluginOptions) {

    // Merchant profile  / Dashboard (Admin)
    app.get("/merchant/me", { preHandler: [authenticate, requireRole([UserRole.MERCHANT_ADMIN]),requireMerchantContext]}, 
    async (request: FastifyRequest, reply: FastifyReply)=> {
        return reply.status(200).send({
            message: "Merchant profile fetched successfully",
            merchant: request.merchant,
            currentUser: {
                id: request.user.userId,
                email: request.user.email,
                role: request.user.role
            }
        });
    });

    // Platform Ops Admin Route (Accessible Only by OPS_ADMIN)
    // 1. List all merchants
    app.get("/admin/merchants", {preHandler: [authenticate, requireRole([UserRole.OPS_ADMIN])]}, 
    async (request: FastifyRequest, reply: FastifyReply)=> {
       const merchants = await prisma.merchant.findMany({
        include: {
            _count:{
                select: { users: true }
            }
        }
       });

       return reply.status(200).send({
        message:"Merchants fetched successfully",
        merchants
       });
    })
        
}