
import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../database/prisma.js";
import { UserRole } from "@prisma/client";


// 1. Authentication: verifies JWT
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    try {
        await request.jwtVerify();
    }
    catch (err){
        return reply.status(401).send({
            error: "Unauthorised access",
            message:"Invalid or expired token"
        });
    }
}

// 2. Authorization: Role-based access control (RBAC)
export function requireRole(allowedRoles: UserRole[]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const user = request.user;
        if (!user || !allowedRoles.includes(user.role)) {
            return reply.status(403).send({
                error: "Forbidden",
                message: "You do not have permission to access this resource"
            });
        }
    };
}
// 3. Multi-Tenant Isolation: Merchant Context Guard
export async function requireMerchantContext(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;
    if (!user || !user.merchantId) {
        return reply.status(403).send({
            error: "Forbidden",
            message: "Merchant context is required for this operation"
        });
    }
    // Verify merchant is still ACTIVE in the database
    const merchant = await prisma.merchant.findUnique({
        where: { id: user.merchantId }
    });
    if (!merchant) {
        return reply.status(404).send({
            error: "Not Found",
            message: "Merchant not found"
        });
    }
    if (merchant.status !== "ACTIVE") {
        return reply.status(403).send({
            error: "Forbidden",
            message: "Merchant account is suspended or inactive"
        });
    }
    // Attach merchant to the request for subsequent handlers
    request.merchant = merchant;
}
